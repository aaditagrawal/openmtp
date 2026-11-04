package mtp

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

var ErrObjectPropListUnsupported = errors.New("MTP object property list unsupported")
var ErrIncompleteDirectoryMetadata = errors.New("MTP directory metadata incomplete")

const MaxBatchedDirectoryObjects = 16384

func propertyListUnsupported(rc RCError) bool {
	switch rc {
	case RC_OperationNotSupported, RC_ParameterNotSupported, RC_MTP_Specification_By_Group_Unsupported, RC_MTP_Specification_By_Depth_Unsupported:
		return true
	}
	return false
}

func SupportsObjectPropList(info *DeviceInfo) bool {
	if info != nil {
		for _, op := range info.OperationsSupported {
			if op == OC_MTP_GetObjPropList {
				return true
			}
		}
	}
	return false
}

// DirectoryMetadata contains only the fields consumed by Kalam's browsing
// FileInfo, not a synthetic ObjectInfo suitable for transfers or mutations.
type DirectoryMetadata struct {
	Handle   uint32
	Name     string
	Size     int64
	IsDir    bool
	Modified time.Time
}

// DirectoryMetadataFromProperties uses the authoritative GetObjectHandles order
// and membership. Depth-one property lists may also contain the parent, other
// storages' roots, and unrelated records. A missing/incomplete child requests a
// legacy fallback rather than returning an empty or partial successful listing.
func DirectoryMetadataFromProperties(props []ObjectProperty, handles []uint32, storage, parent uint32) ([]DirectoryMetadata, error) {
	if len(handles) > MaxBatchedDirectoryObjects {
		return nil, ErrIncompleteDirectoryMetadata
	}
	wanted := make(map[uint32]bool, len(handles))
	for _, h := range handles {
		if h == 0 || h == GOH_ROOT_PARENT || wanted[h] {
			return nil, fmt.Errorf("invalid/duplicate directory handle %d", h)
		}
		wanted[h] = true
	}
	type record struct {
		values map[uint16]ObjectProperty
	}
	records := make(map[uint32]*record, len(handles))
	for _, p := range props {
		if !wanted[p.Handle] {
			continue
		}
		var expected uint16
		switch p.Code {
		case OPC_StorageID, OPC_ParentObject:
			expected = DTC_UINT32
		case OPC_ObjectFormat:
			expected = DTC_UINT16
		case OPC_ObjectSize:
			expected = DTC_UINT64
		case OPC_ObjectFileName, OPC_DateModified:
			expected = DTC_STR
		default:
			continue
		}
		if p.Type != expected {
			return nil, fmt.Errorf("wrong type for MTP property %#x", p.Code)
		}
		r := records[p.Handle]
		if r == nil {
			r = &record{values: make(map[uint16]ObjectProperty)}
			records[p.Handle] = r
		}
		if _, duplicate := r.values[p.Code]; duplicate {
			return nil, fmt.Errorf("duplicate MTP property %#x", p.Code)
		}
		r.values[p.Code] = p
	}
	var result []DirectoryMetadata
	for _, h := range handles {
		r := records[h]
		if r == nil {
			return nil, ErrIncompleteDirectoryMetadata
		}
		v := r.values
		for _, code := range []uint16{OPC_StorageID, OPC_ParentObject, OPC_ObjectFormat, OPC_ObjectFileName, OPC_DateModified} {
			if _, ok := v[code]; !ok {
				return nil, ErrIncompleteDirectoryMetadata
			}
		}
		p := uint32(v[OPC_ParentObject].Number)
		root := parent == GOH_ROOT_PARENT && (p == 0 || p == GOH_ROOT_PARENT)
		if uint32(v[OPC_StorageID].Number) != storage || (!root && p != parent) {
			// A handle in the scoped enumeration disagrees with the property
			// dataset. Do not turn inconsistent membership into success.
			return nil, ErrIncompleteDirectoryMetadata
		}
		entry := DirectoryMetadata{Handle: h, Name: v[OPC_ObjectFileName].String, IsDir: v[OPC_ObjectFormat].Number == OFC_Association}
		if !entry.IsDir {
			size, ok := v[OPC_ObjectSize]
			if !ok {
				return nil, ErrIncompleteDirectoryMetadata
			}
			if size.Number > math.MaxInt64 {
				return nil, fmt.Errorf("MTP object size exceeds FileInfo range")
			}
			entry.Size = int64(size.Number)
		}
		// Match the vendored ObjectInfo date decoder, including Samsung's
		// trailing dots, explicit offsets and zone-less local wall times.
		s := strings.TrimRight(v[OPC_DateModified].String, ".")
		if s != "" {
			var err error
			entry.Modified, err = time.ParseInLocation(timeFormat+"Z0700", s, time.Local)
			if err != nil {
				entry.Modified, err = time.ParseInLocation(timeFormat, s, time.Local)
			}
			if err != nil {
				return nil, fmt.Errorf("MTP modification date: %w", err)
			}
		}
		result = append(result, entry)
	}
	return result, nil
}

// TryDirectoryMetadata is a nonrecursive, capability-gated operation. handled
// is false only when it is safe to call the legacy listing. A failed transport,
// malformed dataset or exceeded byte bound must be returned to the caller.
func (d *Device) TryDirectoryMetadata(info *DeviceInfo, storage, parent uint32, handles []uint32) (entries []DirectoryMetadata, handled bool, err error) {
	return tryDirectoryMetadata(d.GetObjectPropList, info, storage, parent, handles)
}

func tryDirectoryMetadata(get func(uint32) ([]ObjectProperty, error), info *DeviceInfo, storage, parent uint32, handles []uint32) ([]DirectoryMetadata, bool, error) {
	if !SupportsObjectPropList(info) || len(handles) > MaxBatchedDirectoryObjects {
		return nil, false, nil
	}
	if len(handles) == 0 {
		return nil, true, nil
	}
	props, err := get(parent)
	if errors.Is(err, ErrObjectPropListUnsupported) {
		return nil, false, nil
	}
	if err != nil {
		return nil, true, err
	}
	entries, err := DirectoryMetadataFromProperties(props, handles, storage, parent)
	if errors.Is(err, ErrIncompleteDirectoryMetadata) {
		return nil, false, nil
	}
	return entries, true, err
}

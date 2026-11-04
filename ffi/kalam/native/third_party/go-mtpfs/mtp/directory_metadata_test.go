package mtp

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"testing"
	"time"
)

var batchedDeviceInfo = &DeviceInfo{OperationsSupported: []uint16{OC_GetObjectInfo, OC_MTP_GetObjPropList}}

func TestDirectoryMetadataMembershipAndOrder(t *testing.T) {
	props := childProperties(8, 1, 5, "second")
	props = append(props, childProperties(9, 1, 5, "first")...)
	props = append(props, childProperties(5, 1, 0, "parent")...)
	props = append(props, childProperties(10, 2, 0, "other storage")...)
	props = append(props, childProperties(11, 1, 100, "grandchild")...)
	got, err := DirectoryMetadataFromProperties(props, []uint32{9, 8}, 1, 5)
	if err != nil || len(got) != 2 || got[0].Name != "first" || got[1].Name != "second" {
		t.Fatalf("membership/order: %v %v", got, err)
	}
	for _, parent := range []uint32{0, GOH_ROOT_PARENT} {
		got, err := DirectoryMetadataFromProperties(childProperties(8, 1, parent, "root child"), []uint32{8}, 1, GOH_ROOT_PARENT)
		if err != nil || len(got) != 1 {
			t.Fatalf("root parent %#x: %v %v", parent, got, err)
		}
	}
}

func TestDirectoryMetadataMissingOrInconsistent(t *testing.T) {
	all := childProperties(8, 1, 5, "file")
	for i := range all {
		props := append([]ObjectProperty{}, all[:i]...)
		props = append(props, all[i+1:]...)
		if _, err := DirectoryMetadataFromProperties(props, []uint32{8}, 1, 5); !errors.Is(err, ErrIncompleteDirectoryMetadata) {
			t.Fatalf("missing property %#x: %v", all[i].Code, err)
		}
	}
	for _, props := range [][]ObjectProperty{nil, childProperties(8, 2, 5, "wrong storage"), childProperties(8, 1, 6, "wrong parent")} {
		if got, err := DirectoryMetadataFromProperties(props, []uint32{8}, 1, 5); !errors.Is(err, ErrIncompleteDirectoryMetadata) || got != nil {
			t.Fatalf("inconsistent result: %v %v", got, err)
		}
	}
	for _, handles := range [][]uint32{{0}, {GOH_ROOT_PARENT}, {8, 8}} {
		if _, err := DirectoryMetadataFromProperties(all, handles, 1, 5); err == nil {
			t.Fatal("invalid handle accepted")
		}
	}
}

func TestDirectoryMetadataTypesDatesAndDirectories(t *testing.T) {
	for _, bad := range []string{"type", "duplicate", "date", "size"} {
		t.Run(bad, func(t *testing.T) {
			props := childProperties(8, 1, 5, "file")
			switch bad {
			case "type":
				props[0].Type = DTC_UINT16
			case "duplicate":
				props = append(props, props[0])
			case "date":
				props[5].String = "yesterday"
			case "size":
				props[3].Number = 1 << 63
			}
			if _, err := DirectoryMetadataFromProperties(props, []uint32{8}, 1, 5); err == nil || errors.Is(err, ErrIncompleteDirectoryMetadata) {
				t.Fatalf("malformed must fail without fallback: %v", err)
			}
		})
	}
	props := childProperties(8, 1, 5, "directory")
	props[2].Number = OFC_Association
	props = append(props[:3], props[4:]...) // Directories need no size property.
	props[4].String = ""
	got, err := DirectoryMetadataFromProperties(props, []uint32{8}, 1, 5)
	if err != nil || !got[0].IsDir || got[0].Size != 0 || !got[0].Modified.IsZero() {
		t.Fatalf("directory: %v %v", got, err)
	}
	for _, date := range []string{"20260102T030405", "20260102T030405Z", "20260102T030405+0530", "20260102T030405."} {
		props := childProperties(8, 1, 5, "file")
		props[5].String = date
		got, err := DirectoryMetadataFromProperties(props, []uint32{8}, 1, 5)
		var legacy struct{ Date time.Time }
		if legacyErr := Decode(bytesReaderForString(date), &legacy); legacyErr != nil {
			t.Fatal(legacyErr)
		}
		if err != nil || !got[0].Modified.Equal(legacy.Date) {
			t.Fatalf("date %q: %v %v", date, got, err)
		}
	}
}

func bytesReaderForString(s string) *bytes.Reader {
	return bytes.NewReader(propertyFixture(ObjectProperty{Type: DTC_STR, String: s})[12:])
}

func TestTryDirectoryMetadataFallback(t *testing.T) {
	for _, tc := range []struct {
		name            string
		info            *DeviceInfo
		count           int
		getErr          error
		incomplete      bool
		called, handled bool
		wantErr         bool
	}{
		{name: "not advertised", info: &DeviceInfo{}, count: 1},
		{name: "no info", count: 1},
		{name: "too many objects", info: batchedDeviceInfo, count: MaxBatchedDirectoryObjects + 1},
		{name: "empty handles", info: batchedDeviceInfo, handled: true},
		{name: "unsupported", info: batchedDeviceInfo, count: 1, getErr: ErrObjectPropListUnsupported, called: true},
		{name: "incomplete", info: batchedDeviceInfo, count: 1, incomplete: true, called: true},
		{name: "transport", info: batchedDeviceInfo, count: 1, getErr: errors.New("USB failed"), called: true, handled: true, wantErr: true},
		{name: "parse", info: batchedDeviceInfo, count: 1, getErr: io.ErrUnexpectedEOF, called: true, handled: true, wantErr: true},
		{name: "success", info: batchedDeviceInfo, count: 1, called: true, handled: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			handles := make([]uint32, tc.count)
			for i := range handles {
				handles[i] = uint32(i + 8)
			}
			_, handled, err := tryDirectoryMetadata(func(parent uint32) ([]ObjectProperty, error) {
				calls++
				if tc.incomplete {
					return nil, nil
				}
				return childProperties(8, 1, parent, "file"), tc.getErr
			}, tc.info, 1, 5, handles)
			if (calls == 1) != tc.called || calls > 1 || handled != tc.handled || (err != nil) != tc.wantErr {
				t.Fatalf("calls=%d handled=%t err=%v", calls, handled, err)
			}
		})
	}
}

// Count fake protocol operations, not USB latency or hardware throughput.
// The baseline models the pinned mtpx Walk's root listing: handles + N infos.
func TestSimulatedDirectoryRequestCounts(t *testing.T) {
	for _, n := range []int{1, 100, 1000} {
		props := make([]ObjectProperty, 0, 6*n)
		handles := make([]uint32, n)
		for i := range handles {
			handles[i] = uint32(i + 1)
			child := childProperties(handles[i], 1, 0, fmt.Sprint(i))
			child[3].Number = 1024 // Baseline needs no extra 64-bit size lookup.
			props = append(props, child...)
		}
		data := propertyFixture(props...)
		requests := 1 // GetObjectHandles, also required by the baseline.
		entries, handled, err := tryDirectoryMetadata(func(parent uint32) ([]ObjectProperty, error) {
			return getObjectPropList(func(_ *Container, _ *Container, dest io.Writer, _ io.Reader, _ int64, _ ProgressFunc) error {
				requests++
				_, err := dest.Write(data)
				return err
			}, parent)
		}, batchedDeviceInfo, 1, GOH_ROOT_PARENT, handles)
		if err != nil || !handled || len(entries) != n || requests != 2 {
			t.Fatalf("n=%d entries=%d handled=%t requests=%d err=%v", n, len(entries), handled, requests, err)
		}
		t.Logf("simulated children=%d baseline=%d candidate=%d operations", n, 1+n, requests)
	}
}

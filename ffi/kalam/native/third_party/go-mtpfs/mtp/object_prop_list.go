package mtp

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"unicode/utf16"
)

// Limits apply to the received dataset, before allocating property records.
// They do not change USB transfer buffer sizes.
const MaxObjectPropListBytes = 8 << 20
const maxObjectPropListEntries = 128 << 10

// ObjectProperty retains the wire type. Numeric values up to UINT64 and strings
// are decoded; other standard scalar/array types are validated and skipped.
type ObjectProperty struct {
	Handle uint32
	Code   uint16
	Type   uint16
	Number uint64
	String string
}

// DecodeObjectPropList decodes one complete MTP ObjectPropList dataset. No
// partially decoded result is returned on failure.
func DecodeObjectPropList(data []byte) ([]ObjectProperty, error) {
	if len(data) > MaxObjectPropListBytes {
		return nil, fmt.Errorf("MTP property list exceeds byte limit")
	}
	r := bytes.NewReader(data)
	var count uint32
	if err := binary.Read(r, byteOrder, &count); err != nil {
		return nil, err
	}
	// Every entry has an eight-byte header and at least one value byte.
	if count > maxObjectPropListEntries || uint64(count)*9 > uint64(r.Len()) {
		return nil, fmt.Errorf("invalid MTP property count %d", count)
	}
	props := make([]ObjectProperty, 0, int(count))
	for i := uint32(0); i < count; i++ {
		var p ObjectProperty
		if err := binary.Read(r, byteOrder, &p.Handle); err != nil {
			return nil, err
		}
		if err := binary.Read(r, byteOrder, &p.Code); err != nil {
			return nil, err
		}
		if err := binary.Read(r, byteOrder, &p.Type); err != nil {
			return nil, err
		}
		if err := decodeObjectProperty(r, &p); err != nil {
			return nil, fmt.Errorf("property %d: %w", i, err)
		}
		props = append(props, p)
	}
	if r.Len() != 0 {
		return nil, fmt.Errorf("trailing MTP property list data")
	}
	return props, nil
}

func scalarWidth(t uint16) int {
	if t < DTC_INT8 || t > DTC_UINT128 {
		return 0
	}
	return 1 << ((t - 1) / 2)
}

func decodeObjectProperty(r *bytes.Reader, p *ObjectProperty) error {
	if p.Type == DTC_STR {
		n, err := r.ReadByte()
		if err != nil {
			return err
		}
		if n == 0 {
			return nil
		}
		units := make([]uint16, int(n))
		if err := binary.Read(r, byteOrder, units); err != nil {
			return err
		}
		if units[len(units)-1] != 0 {
			return fmt.Errorf("unterminated MTP string")
		}
		units = units[:len(units)-1]
		for i := 0; i < len(units); i++ {
			u := units[i]
			if u == 0 {
				return fmt.Errorf("embedded NUL in MTP string")
			}
			if u >= 0xD800 && u <= 0xDBFF {
				if i+1 == len(units) || units[i+1] < 0xDC00 || units[i+1] > 0xDFFF {
					return fmt.Errorf("invalid UTF-16 pair")
				}
				i++
			} else if u >= 0xDC00 && u <= 0xDFFF {
				return fmt.Errorf("invalid UTF-16 pair")
			}
		}
		p.String = string(utf16.Decode(units))
		return nil
	}
	base := p.Type &^ DTC_ARRAY_MASK
	width := scalarWidth(base)
	if width == 0 {
		return fmt.Errorf("unsupported MTP data type %#x", p.Type)
	}
	if p.Type&DTC_ARRAY_MASK != 0 {
		var n uint32
		if err := binary.Read(r, byteOrder, &n); err != nil {
			return err
		}
		length := uint64(n) * uint64(width)
		if length > uint64(r.Len()) {
			return io.ErrUnexpectedEOF
		}
		_, err := r.Seek(int64(length), io.SeekCurrent)
		return err
	}
	var value [16]byte
	if _, err := io.ReadFull(r, value[:width]); err != nil {
		return err
	}
	if width <= 8 {
		for i := width - 1; i >= 0; i-- {
			p.Number = p.Number<<8 | uint64(value[i])
		}
	}
	return nil
}

// cappedPropertyData keeps a sticky overflow flag and drains the data phase.
// Returning a short write here could leave the response unread. Even the first
// Write's error is ignored by the pinned transaction implementation.
type cappedPropertyData struct {
	bytes.Buffer
	overflow bool
}

func (b *cappedPropertyData) Write(p []byte) (int, error) {
	if b.overflow || len(p) > MaxObjectPropListBytes-b.Len() {
		b.overflow = true
		return len(p), nil
	}
	return b.Buffer.Write(p)
}

type propertyTransaction func(*Container, *Container, io.Writer, io.Reader, int64, ProgressFunc) error

// GetObjectPropList requests an object plus its immediate children, or all
// storage roots when parent is GOH_ROOT_PARENT. Callers must filter by storage
// and parent: this operation has no storage parameter. No recursive depth is
// exposed here.
func (d *Device) GetObjectPropList(parent uint32) ([]ObjectProperty, error) {
	return getObjectPropList(d.RunTransaction, parent)
}

func getObjectPropList(run propertyTransaction, parent uint32) ([]ObjectProperty, error) {
	handle := parent
	if handle == GOH_ROOT_PARENT {
		handle = 0
	}
	req := Container{Code: OC_MTP_GetObjPropList, Param: []uint32{handle, 0, 0xFFFFFFFF, 0, 1}}
	var rep Container
	var data cappedPropertyData
	err := run(&req, &rep, &data, nil, 0, EmptyProgressFunc)
	if data.overflow {
		return nil, fmt.Errorf("MTP property list exceeds byte limit")
	}
	if err != nil {
		// Only an explicit, matching, data-free rejection is a safe fallback.
		// RunTransaction checks transaction IDs only on RC_OK in this version.
		if rc, ok := err.(RCError); ok && rep.TransactionID == req.TransactionID && rep.Code == uint16(rc) && data.Len() == 0 && propertyListUnsupported(rc) {
			return nil, ErrObjectPropListUnsupported
		}
		return nil, err
	}
	return DecodeObjectPropList(data.Bytes())
}

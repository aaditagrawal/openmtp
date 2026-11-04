package mtp

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"reflect"
	"testing"
	"unicode/utf16"
)

// Synthetic wire fixtures follow AOSP's ObjectPropList layout. They deliberately
// include values that the old reflection decoder cannot decode safely.
func propertyFixture(props ...ObjectProperty) []byte {
	var b bytes.Buffer
	_ = binary.Write(&b, byteOrder, uint32(len(props)))
	for _, p := range props {
		_ = binary.Write(&b, byteOrder, p.Handle)
		_ = binary.Write(&b, byteOrder, p.Code)
		_ = binary.Write(&b, byteOrder, p.Type)
		if p.Type == DTC_STR {
			units := append(utf16.Encode([]rune(p.String)), 0)
			b.WriteByte(byte(len(units)))
			_ = binary.Write(&b, byteOrder, units)
		} else {
			for i := 0; i < scalarWidth(p.Type); i++ {
				b.WriteByte(byte(p.Number >> uint(8*i)))
			}
		}
	}
	return b.Bytes()
}

func childProperties(h, storage, parent uint32, name string) []ObjectProperty {
	return []ObjectProperty{
		{Handle: h, Code: OPC_StorageID, Type: DTC_UINT32, Number: uint64(storage)},
		{Handle: h, Code: OPC_ParentObject, Type: DTC_UINT32, Number: uint64(parent)},
		{Handle: h, Code: OPC_ObjectFormat, Type: DTC_UINT16, Number: OFC_Undefined},
		{Handle: h, Code: OPC_ObjectSize, Type: DTC_UINT64, Number: 5<<30 + 17},
		{Handle: h, Code: OPC_ObjectFileName, Type: DTC_STR, String: name},
		{Handle: h, Code: OPC_DateModified, Type: DTC_STR, String: "20260102T030405+0530"},
	}
}

func TestObjectPropListDecoding(t *testing.T) {
	props := childProperties(9, 0x10001, 5, "photo-📷.jpg")
	data := propertyFixture(props...)
	got, err := DecodeObjectPropList(data)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, props) {
		t.Fatalf("got %#v, want %#v", got, props)
	}
	entries, err := DirectoryMetadataFromProperties(got, []uint32{9}, 0x10001, 5)
	if err != nil {
		t.Fatal(err)
	}
	if entries[0].Size != 5<<30+17 || entries[0].Modified.UTC().Format("2006-01-02T15:04:05Z") != "2026-01-01T21:34:05Z" {
		t.Fatalf("bad metadata: %+v", entries)
	}
	for i := 0; i < len(data); i++ {
		if partial, err := DecodeObjectPropList(data[:i]); err == nil || partial != nil {
			t.Fatalf("accepted prefix %d", i)
		}
	}
}

func TestObjectPropListBoundsAndTypes(t *testing.T) {
	valid := propertyFixture(ObjectProperty{Handle: 1, Code: OPC_ObjectSize, Type: DTC_UINT64, Number: 1 << 40})
	cases := map[string][]byte{
		"trailing":             append(append([]byte{}, valid...), 0),
		"count":                {255, 255, 255, 255},
		"byte bound":           make([]byte, MaxObjectPropListBytes+1),
		"unknown type":         {1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0xFF, 0x7F, 0},
		"unterminated string":  {1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 255, 255, 1, 65, 0},
		"bad surrogate":        {1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 255, 255, 2, 0, 0xD8, 0, 0},
		"embedded nul":         {1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 255, 255, 2, 0, 0, 0, 0},
		"array count overflow": {1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0x40, 255, 255, 255, 255},
	}
	for name, data := range cases {
		t.Run(name, func(t *testing.T) {
			if result, err := DecodeObjectPropList(data); err == nil || result != nil {
				t.Fatalf("accepted malformed data: %v", err)
			}
		})
	}
	// UINT128 and arrays are skipped without losing the next property's offset.
	var b bytes.Buffer
	_ = binary.Write(&b, byteOrder, uint32(3))
	b.Write([]byte{1, 0, 0, 0, 0x41, 0xDC, 10, 0})
	b.Write(make([]byte, 16))
	b.Write([]byte{1, 0, 0, 0, 0x42, 0xDC, 8, 0x40, 2, 0, 0, 0})
	b.Write(make([]byte, 16))
	b.Write(valid[4:])
	props, err := DecodeObjectPropList(b.Bytes())
	if err != nil || len(props) != 3 || props[2].Number != 1<<40 {
		t.Fatalf("skipped type offset: %v %v", props, err)
	}
}

func TestGetObjectPropListTransaction(t *testing.T) {
	for _, parent := range []uint32{GOH_ROOT_PARENT, 12} {
		calls := 0
		got, err := getObjectPropList(func(req, rep *Container, dest io.Writer, src io.Reader, size int64, cb ProgressFunc) error {
			calls++
			wantHandle := parent
			if parent == GOH_ROOT_PARENT {
				wantHandle = 0
			}
			if req.Code != OC_MTP_GetObjPropList || !reflect.DeepEqual(req.Param, []uint32{wantHandle, 0, 0xFFFFFFFF, 0, 1}) || src != nil || size != 0 {
				t.Fatalf("bad request: %+v", req)
			}
			_, err := dest.Write(propertyFixture(childProperties(4, 1, 12, "file")...))
			return err
		}, parent)
		if err != nil || len(got) != 6 || calls != 1 {
			t.Fatalf("got %v, %v, %d calls", got, err, calls)
		}
	}
}

func TestGetObjectPropListFallbackSafety(t *testing.T) {
	transport := errors.New("USB read failed")
	for _, tc := range []struct {
		name      string
		code      RCError
		data      []byte
		mismatch  bool
		transport error
		fallback  bool
	}{
		{name: "operation unsupported", code: RC_OperationNotSupported, fallback: true},
		{name: "parameter unsupported", code: RC_ParameterNotSupported, fallback: true},
		{name: "group unsupported", code: RC_MTP_Specification_By_Group_Unsupported, fallback: true},
		{name: "depth unsupported", code: RC_MTP_Specification_By_Depth_Unsupported, fallback: true},
		{name: "access denied", code: RC_AccessDenied},
		{name: "wrong transaction", code: RC_OperationNotSupported, mismatch: true},
		{name: "rejection with data", code: RC_OperationNotSupported, data: []byte{0}},
		{name: "truncated success", data: []byte{1, 0}},
		{name: "overflow success", data: make([]byte, MaxObjectPropListBytes+1)},
		{name: "transport", transport: transport},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			got, err := getObjectPropList(func(req, rep *Container, dest io.Writer, _ io.Reader, _ int64, _ ProgressFunc) error {
				calls++
				req.TransactionID = 7
				rep.TransactionID = 7
				if tc.mismatch {
					rep.TransactionID++
				}
				rep.Code = uint16(tc.code)
				_, _ = dest.Write(tc.data)
				if tc.transport != nil {
					return tc.transport
				}
				if tc.code != 0 {
					return tc.code
				}
				return nil
			}, 12)
			if err == nil || got != nil || calls != 1 {
				t.Fatalf("unexpected result %v %v, calls %d", got, err, calls)
			}
			if errors.Is(err, ErrObjectPropListUnsupported) != tc.fallback {
				t.Fatalf("unsafe fallback: %v", err)
			}
		})
	}
}

func TestCappedPropertyData(t *testing.T) {
	var b cappedPropertyData
	_, _ = b.Write(make([]byte, MaxObjectPropListBytes))
	if b.overflow {
		t.Fatal("exact bound rejected")
	}
	for _, data := range [][]byte{{1}, {2, 3}} {
		if n, err := b.Write(data); n != len(data) || err != nil {
			t.Fatal("must drain data phase")
		}
	}
	if !b.overflow || b.Len() != MaxObjectPropListBytes {
		t.Fatal("lost bound or sticky overflow")
	}
}

func FuzzDecodeObjectPropList(f *testing.F) {
	f.Add(propertyFixture(childProperties(4, 1, 12, "file")...))
	f.Add([]byte{0, 0, 0, 0})
	f.Fuzz(func(t *testing.T, data []byte) { _, _ = DecodeObjectPropList(data) })
}

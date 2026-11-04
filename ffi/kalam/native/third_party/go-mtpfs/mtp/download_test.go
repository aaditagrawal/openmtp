//go:build openmtp_manual

package mtp

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"reflect"
	"testing"
)

const downloadPacketSize = 64

type downloadRead struct {
	data []byte
	err  error
}

// Each entry is one USB transfer, including explicit zero-length packets.
// Unexpected reads fail rather than silently draining after a sink failure.
func downloadReader(t *testing.T, reads ...downloadRead) (bulkReadFunc, *int) {
	t.Helper()
	calls := 0
	return func(buf []byte) (int, error) {
		t.Helper()
		if calls >= len(reads) {
			t.Fatalf("unexpected USB read %d", calls+1)
		}
		read := reads[calls]
		calls++
		if len(read.data) > len(buf) {
			t.Fatalf("USB read buffer has %d bytes, need %d", len(buf), len(read.data))
		}
		return copy(buf, read.data), read.err
	}, &calls
}

func downloadContainer(containerType, code uint16, payload []byte, totalPayload int) []byte {
	var buf bytes.Buffer
	_ = binary.Write(&buf, binary.LittleEndian, usbBulkHeader{
		Length:        uint32(usbHdrLen + totalPayload),
		Type:          containerType,
		Code:          code,
		TransactionID: 7,
	})
	buf.Write(payload)
	return buf.Bytes()
}

func downloadResponse() []byte {
	return downloadContainer(USB_CONTAINER_RESPONSE, RC_OK, nil, 0)
}

type downloadFailWriter struct {
	bytes.Buffer
	failCall int
	calls    int
	accepted int
	err      error
}

func (w *downloadFailWriter) Write(p []byte) (int, error) {
	w.calls++
	if w.calls == w.failCall {
		w.Buffer.Write(p[:w.accepted])
		return w.accepted, w.err
	}
	return w.Buffer.Write(p)
}

func TestDownloadDestinationFailures(t *testing.T) {
	sinkErr := errors.New("destination is full")
	for _, stage := range []struct {
		name     string
		failCall int
		bulkSize int
	}{
		{name: "initial", failCall: 1},
		{name: "later short USB transfer", failCall: 2, bulkSize: 13},
		{name: "later packet aligned transfer", failCall: 2, bulkSize: downloadPacketSize},
		{name: "later full buffer", failCall: 2, bulkSize: rwBufSize},
	} {
		t.Run(stage.name, func(t *testing.T) {
			initial := bytes.Repeat([]byte("a"), downloadPacketSize-usbHdrLen)
			bulk := bytes.Repeat([]byte("b"), stage.bulkSize)
			failingSize := len(initial)
			if stage.failCall == 2 {
				failingSize = len(bulk)
			}
			for _, failure := range []struct {
				name     string
				accepted int
				err      error
				wantErr  error
			}{
				{name: "no bytes and error", err: sinkErr, wantErr: sinkErr},
				{name: "partial write and error", accepted: 3, err: sinkErr, wantErr: sinkErr},
				{name: "full write and error", accepted: failingSize, err: sinkErr, wantErr: sinkErr},
				{name: "silent short write", accepted: 3, wantErr: io.ErrShortWrite},
				{name: "silent zero write", wantErr: io.ErrShortWrite},
			} {
				t.Run(failure.name, func(t *testing.T) {
					reads := []downloadRead{{data: downloadContainer(USB_CONTAINER_DATA, OC_GetObject, initial, len(initial)+len(bulk))}}
					if stage.failCall == 2 {
						reads = append(reads, downloadRead{data: bulk})
					}
					read, calls := downloadReader(t, reads...)
					writer := &downloadFailWriter{failCall: stage.failCall, accepted: failure.accepted, err: failure.err}
					progressCalls := 0
					err := (&Device{}).readResponse(&Container{Code: OC_GetObject}, &Container{}, writer,
						func(int64) error { progressCalls++; return errors.New("secondary progress error") }, read, downloadPacketSize)
					if err != failure.wantErr {
						t.Fatalf("got error %v, want original error %v", err, failure.wantErr)
					}
					if *calls != len(reads) || writer.calls != stage.failCall || progressCalls != 0 {
						t.Fatalf("calls: USB %d, writes %d, progress %d", *calls, writer.calls, progressCalls)
					}
					wantWritten := failure.accepted
					if stage.failCall == 2 {
						wantWritten += len(initial)
					}
					if writer.Len() != wantWritten {
						t.Fatalf("wrote %d bytes, want %d", writer.Len(), wantWritten)
					}
				})
			}
		})
	}
}

func TestDownloadSuccess(t *testing.T) {
	for _, test := range []struct {
		name        string
		initialSize int
		bulkSizes   []int
		termination bool
		responseZLP bool
		progress    []int64
	}{
		{name: "empty object"},
		{name: "initial payload only", initialSize: 5},
		{name: "separate header", bulkSizes: []int{13}, progress: []int64{13}},
		{name: "short bulk payload", initialSize: 52, bulkSizes: []int{13}, progress: []int64{13}},
		{name: "aligned initial payload", initialSize: 52, bulkSizes: []int{0}, termination: true, responseZLP: true, progress: []int64{0, 0}},
		{name: "aligned bulk with ZLP", initialSize: 52, bulkSizes: []int{64}, termination: true, progress: []int64{64, 64}},
		{name: "XHCI response instead of ZLP", initialSize: 52, bulkSizes: []int{64}, termination: true, responseZLP: true, progress: []int64{64, 64}},
		{name: "full buffer then short payload", initialSize: 52, bulkSizes: []int{rwBufSize, 13}, progress: []int64{rwBufSize, rwBufSize + 13}},
		{name: "full buffer then ZLP", initialSize: 52, bulkSizes: []int{rwBufSize, 0}, termination: true, responseZLP: true, progress: []int64{rwBufSize, rwBufSize, rwBufSize}},
	} {
		t.Run(test.name, func(t *testing.T) {
			payload := bytes.Repeat([]byte("a"), test.initialSize)
			var bulkReads []downloadRead
			for i, size := range test.bulkSizes {
				data := bytes.Repeat([]byte{byte('b' + i)}, size)
				payload = append(payload, data...)
				bulkReads = append(bulkReads, downloadRead{data: data})
			}
			reads := []downloadRead{{data: downloadContainer(USB_CONTAINER_DATA, OC_GetObject, payload[:test.initialSize], len(payload))}}
			reads = append(reads, bulkReads...)
			if test.termination && !test.responseZLP {
				reads = append(reads, downloadRead{})
			}
			reads = append(reads, downloadRead{data: downloadResponse()})
			read, calls := downloadReader(t, reads...)
			var got bytes.Buffer
			var progress []int64
			d := &Device{session: &sessionData{sid: 1, tid: 7}}
			rep := &Container{}
			err := d.readResponse(&Container{Code: OC_GetObject, SessionID: 1, TransactionID: 7}, rep, &got,
				func(n int64) error { progress = append(progress, n); return nil }, read, downloadPacketSize)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got.Bytes(), payload) {
				t.Fatalf("downloaded %d bytes, want %d, or contents differ", got.Len(), len(payload))
			}
			if *calls != len(reads) || !reflect.DeepEqual(progress, test.progress) {
				t.Fatalf("USB reads %d/%d, progress %v, want %v", *calls, len(reads), progress, test.progress)
			}
			if rep.Code != RC_OK || rep.TransactionID != 7 || rep.SessionID != 1 {
				t.Fatalf("incorrect response: %+v", rep)
			}
			if d.SeparateHeader != (test.initialSize == 0 && len(payload) > 0) {
				t.Fatalf("SeparateHeader = %v", d.SeparateHeader)
			}
		})
	}
}

func TestDownloadPreservesReadAndProgressErrors(t *testing.T) {
	readErr := errors.New("USB read failed")
	progressErr := errors.New("download canceled")
	for _, test := range []struct {
		name     string
		reads    []downloadRead
		progress ProgressFunc
		wantErr  error
	}{
		{name: "first packet", reads: []downloadRead{{err: readErr}}, wantErr: readErr},
		{name: "bulk packet", reads: []downloadRead{{data: downloadContainer(USB_CONTAINER_DATA, OC_GetObject, nil, 64)}, {err: readErr}}, wantErr: readErr},
		{name: "response packet", reads: []downloadRead{{data: downloadContainer(USB_CONTAINER_DATA, OC_GetObject, []byte("a"), 1)}, {err: readErr}}, wantErr: readErr},
		{name: "truncated response", reads: []downloadRead{{data: downloadContainer(USB_CONTAINER_DATA, OC_GetObject, []byte("a"), 1)}, {data: []byte{1}}}, wantErr: io.ErrUnexpectedEOF},
		{name: "termination packet", reads: []downloadRead{{data: downloadContainer(USB_CONTAINER_DATA, OC_GetObject, nil, 64)}, {data: make([]byte, 64)}, {err: readErr}}, progress: func(int64) error { return nil }, wantErr: readErr},
		{name: "progress before termination", reads: []downloadRead{{data: downloadContainer(USB_CONTAINER_DATA, OC_GetObject, nil, 64)}, {data: make([]byte, 64)}}, progress: func(int64) error { return progressErr }, wantErr: progressErr},
	} {
		t.Run(test.name, func(t *testing.T) {
			read, calls := downloadReader(t, test.reads...)
			progress := test.progress
			if progress == nil {
				progress = func(int64) error { return fmt.Errorf("unexpected progress callback") }
			}
			err := (&Device{}).readResponse(&Container{Code: OC_GetObject}, &Container{}, io.Discard, progress, read, downloadPacketSize)
			if err != test.wantErr || *calls != len(test.reads) {
				t.Fatalf("got %v after %d reads, want %v after %d reads", err, *calls, test.wantErr, len(test.reads))
			}
		})
	}
}

func TestDownloadBulkReadCountsAcceptedBytes(t *testing.T) {
	sinkErr := errors.New("destination write failed")
	read, _ := downloadReader(t, downloadRead{data: make([]byte, rwBufSize)}, downloadRead{data: make([]byte, 64)})
	writer := &downloadFailWriter{failCall: 2, accepted: 3, err: sinkErr}
	n, last, err := (&Device{}).bulkRead(writer, EmptyProgressFunc, read, downloadPacketSize)
	if n != rwBufSize+3 || err != sinkErr || len(last) != 0 {
		t.Fatalf("got count %d, last packet %d bytes, error %v", n, len(last), err)
	}
}

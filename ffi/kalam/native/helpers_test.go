//go:build openmtp_manual

package main

import (
	"os"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ganeshrvel/go-mtpfs/mtp"
	"github.com/ganeshrvel/go-mtpx"
)

func TestSessionLockRejectsConcurrentOperation(t *testing.T) {
	if err := lockMtp(); err != nil {
		t.Fatal(err)
	}
	if err := lockMtp(); err == nil {
		t.Fatal("concurrent session accepted")
	}
	unlockMtp()
	if err := lockMtp(); err != nil {
		t.Fatal(err)
	}
	unlockMtp()
}

func TestDisposeClearsStaleDeviceInfo(t *testing.T) {
	container.deviceInfo = &mtp.DeviceInfo{}
	if err := _dispose(); err != nil {
		t.Fatal(err)
	}
	if container.deviceInfo != nil || container.dev != nil || container.context != nil {
		t.Fatal("stale session retained")
	}
}

func TestProgressSnapshotIsIndependent(t *testing.T) {
	input := &mtpx.ProgressInfo{FileInfo: &mtpx.FileInfo{Name: "before"}}
	snapshot := cloneProgressInfo(input)
	input.FileInfo.Name = "after"
	if snapshot.FileInfo.Name != "before" {
		t.Fatal("snapshot aliases mutable native progress")
	}
	if cloneProgressInfo(nil) != nil {
		t.Fatal("nil snapshot changed")
	}
}

func TestProgressPumpStopsAndFlushesOnce(t *testing.T) {
	var flushes atomic.Int32
	stop := startProgressPump(time.Hour, func() { flushes.Add(1) })
	stop()
	stop()
	if flushes.Load() != 1 {
		t.Fatalf("expected one final flush, got %d", flushes.Load())
	}
}

func TestDisconnectedInitializeReleasesContext(t *testing.T) {
	if os.Getenv("OPENMTP_NATIVE_HARDWARE_TEST") != "1" {
		t.Skip("opt-in read-only USB enumeration")
	}
	before := runtime.NumGoroutine()
	for i := 0; i < 100; i++ {
		device, err := _initialize(mtpx.Init{})
		if device != nil {
			_ = _dispose()
			t.Skip("MTP device attached; disconnected stress requires no phone")
		}
		if err == nil {
			t.Fatal("missing device accepted")
		}
		if container.dev != nil || container.context != nil || container.deviceInfo != nil {
			t.Fatalf("iteration %d leaked native session", i)
		}
		if err := _dispose(); err != nil {
			t.Fatal(err)
		}
	}
	runtime.GC()
	if runtime.NumGoroutine() > before+2 {
		t.Fatal("goroutines grew after disconnected retries")
	}
}

func TestMain(m *testing.M) {
	if os.Getenv("CI") != "" {
		panic("Native tests are local-only")
	}
	os.Exit(m.Run())
}

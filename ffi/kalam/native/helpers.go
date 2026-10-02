package main

import (
	"fmt"
	"github.com/ganeshrvel/usb"
	"kalam/send_to_js"
	"os"
	"runtime/debug"
	"sync"
	"time"

	"github.com/ganeshrvel/go-mtpfs/mtp"
	"github.com/ganeshrvel/go-mtpx"
)

func verifyMtpSession(c verifyMtpSessionMode) error {
	if container.dev == nil {
		return fmt.Errorf("ErrorMtpDetectFailed")
	}

	if !c.skipDeviceChangeCheck && container.deviceInfo != nil {
		dInfo, err := mtpx.FetchDeviceInfo(container.dev)
		if err != nil {
			container.deviceInfo = nil

			_ = _dispose()

			return err
		}

		if container.deviceInfo.SerialNumber != dInfo.SerialNumber {
			container.deviceInfo = dInfo

			return fmt.Errorf("ErrorDeviceChanged")
		}
	}

	return nil
}

func _initialize(i mtpx.Init) (*mtp.Device, error) {
	// Close a previous session before reconnecting. Store resources immediately
	// so panic recovery and every later failure can release them.
	_ = _dispose()
	container.context = usb.NewContext()
	if container.context == nil {
		return nil, fmt.Errorf("ErrorMtpDetectFailed")
	}
	d, err := mtp.SelectDeviceWithContext(container.context, "", i.DebugMode)
	if err != nil {
		_ = _dispose()
		return nil, fmt.Errorf("ErrorMtpDetectFailed: %w", err)
	}
	container.dev = d
	d.Timeout = 15000
	if err := d.Configure(); err != nil {
		_ = _dispose()
		return nil, fmt.Errorf("ErrorDeviceSetup: %w", err)
	}
	return d, nil
}

// skipDeviceChangeCheckMode skips the FetchDeviceInfo serial round-trip.
// Use on hot read-only paths (Walk/list/exists). Keep the check on Initialize
// (via _fetchDeviceInfo), transfers, and mutating ops so a swapped device is
// still detected before write/transfer work.
var skipDeviceChangeCheckMode = verifyMtpSessionMode{skipDeviceChangeCheck: true}

func _fetchDeviceInfo() (*mtp.DeviceInfo, error) {
	// Always skip here: this path itself fetches and stores DeviceInfo.
	if err := verifyMtpSession(skipDeviceChangeCheckMode); err != nil {
		return nil, err
	}

	dInfo, err := mtpx.FetchDeviceInfo(container.dev)
	if err != nil {
		container.deviceInfo = nil

		return nil, err
	}

	container.deviceInfo = dInfo

	return dInfo, nil
}

func _fetchStorages() ([]mtpx.StorageData, error) {
	if err := verifyMtpSession(skipDeviceChangeCheckMode); err != nil {
		return nil, err
	}

	storages, err := mtpx.FetchStorages(container.dev)
	if err != nil {
		return nil, err
	}

	return storages, nil
}

func _makeDirectory(storageId uint32, fullPath string) error {
	if err := verifyMtpSession(verifyMtpSessionMode{}); err != nil {
		return err
	}

	_, err := mtpx.MakeDirectory(container.dev, storageId, fullPath)
	if err != nil {
		return err
	}

	return nil
}

func _fileExists(storageId uint32, fileProps []mtpx.FileProp) (exists []mtpx.FileExistsContainer, error error) {
	if err := verifyMtpSession(skipDeviceChangeCheckMode); err != nil {
		return []mtpx.FileExistsContainer{}, err
	}

	exists, err := mtpx.FileExists(container.dev, storageId, fileProps)
	if err != nil {
		return exists, err
	}
	// go-mtpx returns an empty successful slice for some transport errors.
	// Treat incomplete answers as failures, never as proof a path is absent.
	if len(exists) != len(fileProps) {
		return nil, fmt.Errorf("incomplete MTP file-existence response")
	}
	return exists, nil
}

func _deleteFile(storageId uint32, fileProps []mtpx.FileProp) (error error) {
	if err := verifyMtpSession(verifyMtpSessionMode{}); err != nil {
		return err
	}

	err := mtpx.DeleteFile(container.dev, storageId, fileProps)
	if err != nil {
		return err
	}

	return nil
}

func _renameFile(storageId uint32, fileProp mtpx.FileProp, newFileName string) (error error) {
	if err := verifyMtpSession(verifyMtpSessionMode{}); err != nil {
		return err
	}

	_, err := mtpx.RenameFile(container.dev, storageId, fileProp, newFileName)
	if err != nil {
		return err
	}

	return nil
}

func _walk(storageId uint32, fullPath string, recursive, skipDisallowedFiles, skipHiddenFiles bool) (files []send_to_js.FileInfo, err error) {
	if err := verifyMtpSession(skipDeviceChangeCheckMode); err != nil {
		return nil, err
	}

	_, _, _, err = mtpx.Walk(container.dev, storageId, fullPath, recursive, skipDisallowedFiles, skipHiddenFiles, func(objectId uint32, fi *mtpx.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Project directly into the wire representation, avoiding a second
		// O(n) slice of native pointers and a second traversal at serialization.
		files = append(files, send_to_js.NewFileInfo(fi))

		return nil
	})
	if err != nil {
		return nil, err
	}

	return files, nil
}

func _uploadFiles(storageId uint32, sources []string, destination string, preprocessFiles bool, preprocessCb mtpx.LocalPreprocessCb, progressCb mtpx.ProgressCb) (err error) {
	if err := verifyMtpSession(verifyMtpSessionMode{}); err != nil {
		return err
	}

	_, _, _, err = mtpx.UploadFiles(container.dev, storageId, sources, destination, preprocessFiles, preprocessCb, progressCb)
	if err != nil {
		return err
	}

	return nil
}

func _downloadFiles(storageId uint32, sources []string, destination string, preprocessFiles bool, preprocessCb mtpx.MtpPreprocessCb, progressCb mtpx.ProgressCb) (err error) {
	if err := verifyMtpSession(verifyMtpSessionMode{}); err != nil {
		return err
	}

	_, _, err = mtpx.DownloadFiles(container.dev, storageId, sources, destination, preprocessFiles, preprocessCb, progressCb)
	if err != nil {
		return err
	}

	return nil
}

func _dispose() error {
	device, context := container.dev, container.context
	container.dev, container.context, container.deviceInfo = nil, nil, nil
	if context != nil {
		defer context.Exit()
	}
	if device != nil {
		defer device.Done()
		return device.Close()
	}
	return nil
}

// This boundary runs while the export still owns the mutex. A recovered Go
// panic invalidates the session; never continue using partially mutated state.
func recoverMtpPanic(done *send_to_js.SendCbResult) {
	if value := recover(); value != nil {
		fmt.Fprintf(os.Stderr, "Kalam panic: %v\n%s", value, debug.Stack())
		func() {
			defer func() { _ = recover() }()
			_ = _dispose()
		}()
		send_to_js.SendError(done, fmt.Errorf("native MTP operation failed: %v", value))
	}
}

// lockMtp acquires an exclusive MTP session lock for the full export call.
// Callers must defer unlockMtp after a successful lock. TryLock (not Lock)
// so a concurrent export fails fast with ErrorMtpLockExists instead of
// blocking the JS bridge.
func lockMtp() error {
	if !container.mu.TryLock() {
		return fmt.Errorf("ErrorMtpLockExists")
	}

	return nil
}

func unlockMtp() {
	container.mu.Unlock()
}

// cloneProgressInfo copies mtpx.ProgressInfo (and nested pointers) so the
// progress pump can read a stable snapshot while mtpx mutates its reused pInfo.
func cloneProgressInfo(p *mtpx.ProgressInfo) *mtpx.ProgressInfo {
	if p == nil {
		return nil
	}

	cp := *p

	if p.FileInfo != nil {
		fi := *p.FileInfo
		cp.FileInfo = &fi
	}

	if p.ActiveFileSize != nil {
		afs := *p.ActiveFileSize
		cp.ActiveFileSize = &afs
	}

	if p.BulkFileSize != nil {
		bfs := *p.BulkFileSize
		cp.BulkFileSize = &bfs
	}

	return &cp
}

// startProgressPump runs flush on interval until stop is called.
// stop signals via close (never blocks like an unbuffered send can) and
// waits for a final flush so the last progress event is not dropped.
func startProgressPump(interval time.Duration, flush func()) (stop func()) {
	done := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)

	go func() {
		defer wg.Done()

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-done:
				flush()

				return
			case <-ticker.C:
				flush()
			}
		}
	}()

	var once sync.Once

	return func() {
		once.Do(func() {
			close(done)
			wg.Wait()
		})
	}
}

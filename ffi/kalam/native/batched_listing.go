package main

import (
	"os"
	"path"
	"strings"

	"github.com/ganeshrvel/go-mtpfs/mtp"
	"github.com/ganeshrvel/go-mtpx"
	"kalam/send_to_js"
)

func useBatchedListing(recursive bool, info *mtp.DeviceInfo) bool {
	return !recursive && os.Getenv("OPENMTP_BATCHED_LISTING") == "1" && mtp.SupportsObjectPropList(info)
}

func tryBatchedWalk(storage uint32, fullPath string, skipDisallowed, skipHidden bool) ([]send_to_js.FileInfo, bool, error) {
	resolve := func(storage uint32, path string) (*mtpx.FileInfo, error) {
		return mtpx.GetObjectFromPath(container.dev, storage, path)
	}
	return tryBatchedWalkOn(container.dev, container.deviceInfo, resolve, storage, fullPath, skipDisallowed, skipHidden)
}

type browsingDevice interface {
	GetObjectHandles(uint32, uint32, uint32, *mtp.Uint32Array) error
	TryDirectoryMetadata(*mtp.DeviceInfo, uint32, uint32, []uint32) ([]mtp.DirectoryMetadata, bool, error)
}

func tryBatchedWalkOn(dev browsingDevice, info *mtp.DeviceInfo, resolve func(uint32, string) (*mtpx.FileInfo, error), storage uint32, fullPath string, skipDisallowed, skipHidden bool) ([]send_to_js.FileInfo, bool, error) {
	// Retain mtpx's path normalization, case folding, invalid-path errors and
	// per-component checks. Optimizing path resolution is a separate change.
	parent, err := resolve(storage, fullPath)
	if err != nil {
		return nil, true, err
	}
	// Walk accepts file paths too, and rejects a disallowed target before it
	// enumerates children. Keep those cases entirely on its existing path.
	if !parent.IsDir || (skipDisallowed && disallowedBrowsingName(parent.Name)) {
		return nil, false, nil
	}
	var handles mtp.Uint32Array
	if err := dev.GetObjectHandles(storage, mtp.GOH_ALL_ASSOCS, parent.ObjectId, &handles); err != nil {
		return nil, true, send_to_js.DirectoryListingError{Cause: err}
	}
	entries, handled, err := dev.TryDirectoryMetadata(info, storage, parent.ObjectId, handles.Values)
	if err != nil {
		return nil, true, send_to_js.DirectoryListingError{Cause: err}
	}
	if !handled {
		return nil, false, nil
	}
	return browsingFiles(entries, fullPath, skipDisallowed, skipHidden), true, nil
}

func browsingFiles(entries []mtp.DirectoryMetadata, parentPath string, skipDisallowed, skipHidden bool) []send_to_js.FileInfo {
	var files []send_to_js.FileInfo
	for _, e := range entries {
		// Match the pinned mtpx walk's case-sensitive filters exactly.
		if skipHidden && strings.HasPrefix(e.Name, ".") {
			continue
		}
		if skipDisallowed && disallowedBrowsingName(e.Name) {
			continue
		}
		fi := mtpx.FileInfo{
			Name: e.Name, Size: e.Size, IsDir: e.IsDir, ModTime: e.Modified,
			FullPath:  path.Clean("/" + parentPath + "/" + e.Name),
			Extension: browsingExtension(e.Name, e.IsDir),
		}
		files = append(files, send_to_js.NewFileInfo(&fi))
	}
	return files
}

func disallowedBrowsingName(name string) bool {
	return name == ".DS_Store" || name == "[-----DS_Store.mtp.test----].txt"
}

// The pinned mtpx extension policy preserves case and recognizes tar.* only.
func browsingExtension(name string, isDir bool) string {
	if isDir {
		return ""
	}
	_, name = path.Split(name)
	parts := strings.Split(name, ".")
	if len(parts) > 2 && parts[len(parts)-2] == "tar" {
		return strings.Join(parts[len(parts)-2:], ".")
	}
	if len(parts) > 1 {
		return parts[len(parts)-1]
	}
	return ""
}

# Experimental batched directory browsing

`OPENMTP_BATCHED_LISTING=1` opts into GetObjectPropList for nonrecursive Kalam
browsing when the current session's DeviceInfo advertises operation `0x9805`.
Rebuild the native backend, then start OpenMTP with this variable in its process
environment. An already-running app will not inherit a new shell variable.
The default remains the pinned go-mtpx walk. No physical phone was available
for this change; hardware validation is required before enabling it by default.

```sh
bun run build-native
OPENMTP_BATCHED_LISTING=1 bun run start
```

The existing go-mtpx path resolver still handles normalization, case-insensitive
matching, file paths and invalid-path errors. Sibling-name requests during path
resolution are unchanged. Recursive walks, including Smart Sync, never use this
path. Neither metadata nor capability failures are cached. Reconnects, mutations
and external device changes therefore require no new cache invalidation rules.

For an eligible directory, Kalam requests storage-scoped GetObjectHandles and
then GetObjectPropList with `[parent, 0, 0xffffffff, 0, 1]`. The root sentinel
becomes handle `0`, which requests roots across storages. The handle list controls
membership and ordering. Parent, storage, name, format and modification date must
be present for every enumerated child; regular files also require a UINT64 size.
Other storages, the parent object and deeper descendants in the property dataset
cannot leak into the result. A missing or inconsistent child triggers the existing
walk, rather than returning a partial or empty successful listing. Directory size,
timestamps, extension handling, hidden/disallowed filters and the JS FileInfo
format retain the existing browsing rules. Full ObjectInfo records are not
synthesized for transfers or mutations.

Fallback is allowed for valid incomplete datasets and explicit, data-free
OperationNotSupported, ParameterNotSupported, SpecificationByGroupUnsupported
or SpecificationByDepthUnsupported responses with a matching transaction ID.
Other response errors, transport errors, malformed types/strings/dates, duplicate
properties, truncated datasets, oversized sizes and byte/entry limit failures
return a listing error with no legacy retry in that call. Existing special error
mapping for locked/unavailable storage is retained.

The new decoder accepts at most 8 MiB and 131,072 property records. Directories
above 16,384 scoped handles bypass the batch request. The capped receive writer
retains at most 8 MiB; on overflow it discards subsequent data until the existing
transaction completes, then returns an error. It does not abort mid-data or
attempt a second command on a possibly unsynchronized stream. USB transfer buffers
and timeout behavior are unchanged. This bounds retained dataset memory, not the
total number of bytes a device might send. The pre-existing GetObjectHandles
transport and decoder are unchanged.

## Device-free checks

Linux requires libusb development headers and pkg-config; macOS uses the existing
native build prerequisites. These commands do not perform device mutation:

```sh
go -C ffi/kalam/native test -race -tags openmtp_manual ./...
go -C ffi/kalam/native/third_party/go-mtpfs test -race ./mtp
go -C ffi/kalam/native/third_party/go-mtpfs test ./mtp \
  -run '^TestSimulatedDirectoryRequestCounts$' -v
go -C ffi/kalam/native/third_party/go-mtpfs test ./mtp \
  -run '^$' -fuzz '^FuzzDecodeObjectPropList$' -fuzztime=10s -parallel=2
```

Leave `OPENMTP_NATIVE_HARDWARE_TEST` unset. Do not run all upstream vendored tests
with `openmtp_manual`; those include physical-device mutation tests.

The fake transaction consumes synthetic wire datasets through the actual new
decoder and directory projection. Its candidate counts are checked against the
root listing request shape in the pinned go-mtpx Walk. The baseline counts are a
model of that implementation, not USB measurements. Counts exclude common
session/device-info operations and path resolution, and assume complete metadata
and regular files below 4 GiB on the baseline. Large baseline files need another
ObjectSize request. Empty directories need only GetObjectHandles in either path.

| Children | Baseline master, modeled operations | Candidate, fake operations |
| ---: | ---: | ---: |
| 1 | 2 | 2 |
| 100 | 101 | 2 |
| 1,000 | 1,001 | 2 |

The baseline is owned master `6eb3e7b`. These are simulated request counts, not
measured latency or throughput. On fallback, the candidate pays for its probe
before running the legacy walk. Multi-storage root datasets and verbose media
properties may hit the byte/entry limits even for smaller scoped directories.

Hardware work remains: compare complete JS listing output with the default on
multiple Android devices and storages, verify root/non-root and large-directory
behavior, exercise device rejection/lock/disconnect cases, and measure real
request traces and listing latency. No throughput improvement is claimed.

Protocol references:

- [AOSP MtpServer request parameter mapping](https://android.googlesource.com/platform/frameworks/av/+/80fe51abceff41bc0216093104fa914103f43356/media/mtp/MtpServer.cpp)
- [AOSP MtpDatabase depth-one/root and all-properties behavior](https://android.googlesource.com/platform/frameworks/base/+/20d711cf4c54d3fb7d1cec6cc10b25821b9f551b/media/java/android/mtp/MtpDatabase.java)

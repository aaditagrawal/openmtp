# OpenMTP native lifecycle patches

Source: `github.com/ganeshrvel/go-mtpfs`, version
`v1.0.4-0.20240426083057-1c3302b3c476`.
The original LICENSE is retained. No upstream repository was modified.

The local replacement adds `SelectDeviceWithContext` so Kalam can own and close
its libusb context. Selection closes and unreferences every unsuccessful
candidate, including errors during device identification/configuration and
multiple-device detection. The original selector created contexts without
closing them, including failed detection on every disconnected launch/retry.

Kalam closes and unreferences its selected device before exiting the context.

Only the `mtp` package is retained. Kalam and go-mtpx do not import the upstream
FUSE filesystem, command-line mount application, or code-generation helper.
The module no longer requires go-fuse. Upstream MTP tests remain available with
`go test -tags openmtp_manual ./mtp -run 'Test(DecodeTime|TimeZonesPreserveInstants)$'`.
The other upstream tests include physical-device mutation tests; run those only
against disposable fixtures.

Date decoding preserves UTC `Z` and numeric offsets and interprets zone-less
Android timestamps in the host's local timezone. Android emits local wall time
in [MtpUtils.cpp](https://android.googlesource.com/platform/frameworks/av/+/754a4310b132681592fa9ed8d449b9953795056b/media/mtp/MtpUtils.cpp).
This fixes the observed +05:30 shift when downloading files on an IST host.
Zone-less timestamps cannot identify a device timezone different from the host.

Kalam converts decoded timestamps to UTC before serializing its `dateAdded`
field with a `Z` suffix, so listings and downloaded mtimes describe the same instant.

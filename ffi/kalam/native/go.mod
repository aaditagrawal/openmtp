module kalam

go 1.27

require (
	github.com/ganeshrvel/go-mtpfs v1.0.4-0.20240426083057-1c3302b3c476
	github.com/ganeshrvel/go-mtpx v0.0.0-20240426092756-18f12db021cc
	github.com/ganeshrvel/usb v0.0.0-20210103155855-14d96f5ae403
)

///##### Upgrade a package
//go get github.com/<org-name>/<package-name>@<git-commit-hash>

//example: go get github.com/ganeshrvel/go-mtpfs@<git-commit-hash>
//example: go get github.com/ganeshrvel/go-mtpx@<git-commit-hash>

///##### Use a local package
// replace github.com/ganeshrvel/go-mtpfs vxxxxxx-xxxxxxxxxx
// with ../go-mtpfs

replace github.com/ganeshrvel/go-mtpfs => ./third_party/go-mtpfs

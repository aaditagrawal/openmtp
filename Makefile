SHELL := /bin/bash
.DEFAULT_GOAL := build

.PHONY: verify test build package run format format-check clean
verify:
	./macos/scripts/verify-environment.sh
test: verify
	./macos/scripts/test-release-policy.sh
	./macos/scripts/swift-test.sh
build: verify
	./macos/scripts/bundle-app.sh
package: build
	./macos/scripts/package-app.sh
run: build
	./macos/build/OpenMTP.app/Contents/MacOS/OpenMTP
format:
	swift format format --in-place --recursive macos/Sources macos/Tests macos/Package.swift
format-check:
	swift format lint --strict --recursive macos/Sources macos/Tests macos/Package.swift
clean:
	swift package --package-path macos clean

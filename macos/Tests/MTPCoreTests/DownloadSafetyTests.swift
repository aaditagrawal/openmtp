import Foundation
import Testing
@testable import MTPCore
@testable import MTPSimulation

@Suite("Download commits")
struct DownloadSafetyTests {
    private func directory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("download-safety-\(UUID())")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test(arguments: [UInt64(0), 17, 0xFFFF_FFFF, 0x1_0000_0000, 0x1_0000_0025, UInt64.max],
          [MTPDevice.ListingStrategy.objectInfo, .propertyList])
    func metadataMismatchPreservesDestination(expected: UInt64, strategy: MTPDevice.ListingStrategy) throws {
        let sim = SimulatedDevice()
        let h = sim.add("file", contents: Data([1, 2, 3]))
        sim.reportedSizes[h] = expected // No large allocation, even for UInt64.max.
        sim.unknownLengthThreshold = 0 // Unknown transport length, known metadata length.
        let device = try MTPDevice(transport: sim)
        device.listingStrategy = strategy
        let object = try #require(try device.children(storage: sim.storageID).first)
        #expect(object.size == expected)
        let dir = try directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let destination = dir.appendingPathComponent("file")
        let previous = Data("existing destination".utf8)
        try previous.write(to: destination)
        let otherPartial = dir.appendingPathComponent(".file.openmtp-partial")
        try Data("another transfer".utf8).write(to: otherPartial)

        #expect(throws: MTPError.transport("received 3 of \(expected) bytes for file")) {
            try device.download(object, to: destination)
        }
        #expect(try Data(contentsOf: destination) == previous)
        #expect(try Data(contentsOf: otherPartial) == Data("another transfer".utf8))
        #expect(try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted() == [".file.openmtp-partial", "file"])
        #expect(sim.violations.isEmpty)
    }

    @Test(arguments: [MTPDevice.ListingStrategy.objectInfo, .propertyList], [false, true])
    func missingSizeIsExplicitAndUnknownContainersStillWork(strategy: MTPDevice.ListingStrategy, splitHeader: Bool) throws {
        let sim = SimulatedDevice()
        sim.splitHeader = splitHeader
        let payload = Data(repeating: 0xAB, count: 90_000)
        sim.add("file", contents: payload)
        sim.omitObjectSizes = true
        sim.unknownLengthThreshold = 0
        let device = try MTPDevice(transport: sim)
        device.session.transferSize = 16 * 1024
        device.listingStrategy = strategy
        let object = try #require(try device.children(storage: sim.storageID).first)
        #expect(object.size == nil)
        let dir = try directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let destination = dir.appendingPathComponent("file")
        try device.download(object, to: destination)
        #expect(try Data(contentsOf: destination) == payload)
        #expect(try device.storages().count == 1)
        #expect(sim.violations.isEmpty)
    }

    @Test(arguments: [false, true], [false, true])
    func successfulCommitReplacesAtomically(unknownContainer: Bool, splitHeader: Bool) throws {
        let sim = SimulatedDevice()
        sim.splitHeader = splitHeader
        sim.add("file", contents: Data())
        if unknownContainer { sim.unknownLengthThreshold = 0 }
        let device = try MTPDevice(transport: sim)
        let object = try #require(try device.children(storage: sim.storageID).first)
        #expect(object.size == 0)
        let dir = try directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let destination = dir.appendingPathComponent("file")
        try Data("old".utf8).write(to: destination)
        try device.download(object, to: destination)
        #expect(try Data(contentsOf: destination).isEmpty)
        #expect(try FileManager.default.contentsOfDirectory(atPath: dir.path) == ["file"])
    }

    @Test func commitFailureCleansOnlyOwnTemporaryFile() throws {
        let sim = SimulatedDevice()
        sim.add("file", contents: Data([5]))
        let device = try MTPDevice(transport: sim)
        let object = try #require(try device.children(storage: sim.storageID).first)
        let dir = try directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let destination = dir.appendingPathComponent("file")
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: false)
        let existing = destination.appendingPathComponent("keep")
        try Data([7]).write(to: existing)
        #expect(throws: POSIXError.self) { try device.download(object, to: destination) }
        #expect(try Data(contentsOf: existing) == Data([7]))
        #expect(try FileManager.default.contentsOfDirectory(atPath: dir.path) == ["file"])
    }

    @Test func cancellationPreservesDestinationAndCleansTemporaryFile() throws {
        let sim = SimulatedDevice()
        sim.add("file", contents: Data(repeating: 5, count: 50_000))
        let device = try MTPDevice(transport: sim)
        device.session.transferSize = 16 * 1024
        let object = try #require(try device.children(storage: sim.storageID).first)
        let dir = try directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let destination = dir.appendingPathComponent("file")
        try Data([7]).write(to: destination)
        #expect(throws: MTPError.cancelled) {
            try device.download(object, to: destination, progress: { _ in throw CancellationError() })
        }
        #expect(try Data(contentsOf: destination) == Data([7]))
        #expect(try FileManager.default.contentsOfDirectory(atPath: dir.path) == ["file"])
    }

    @Test func overlappingCopiesUseDifferentTemporaryFiles() throws {
        let firstSim = SimulatedDevice(), secondSim = SimulatedDevice()
        firstSim.add("first", contents: Data([1]))
        secondSim.add("second", contents: Data([2]))
        let first = try MTPDevice(transport: firstSim), second = try MTPDevice(transport: secondSim)
        let a = try #require(try first.children(storage: firstSim.storageID).first)
        let b = try #require(try second.children(storage: secondSim.storageID).first)
        let dir = try directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let destination = dir.appendingPathComponent("file")
        var secondRan = false
        try first.download(a, to: destination) { _ in
            guard !secondRan else { return }
            secondRan = true
            let partials = try FileManager.default.contentsOfDirectory(atPath: dir.path)
            let firstPartial = try #require(partials.first)
            try second.download(b, to: destination) { _ in
                let partials = try FileManager.default.contentsOfDirectory(atPath: dir.path)
                #expect(partials.count == 2)
                #expect(partials.contains(firstPartial))
            }
            #expect(try Data(contentsOf: destination) == Data([2]))
            #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent(firstPartial).path))
        }
        #expect(secondRan)
        #expect(try Data(contentsOf: destination) == Data([1])) // Last completed copy wins.
        #expect(try FileManager.default.contentsOfDirectory(atPath: dir.path) == ["file"])
    }
}

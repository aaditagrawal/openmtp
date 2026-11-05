import Foundation
import Testing

@testable import MTPCore
@testable import MTPSimulation

@Suite("Scoped directory listings")
struct ListingSafetyTests {
  @Test(arguments: [false, true])
  func overbroadPropertyListsNeverInventMembership(missingIdentity: Bool) throws {
    let sim = SimulatedDevice()
    let first = sim.add("First", directory: true)
    let second = sim.add("Second", directory: true)
    let wanted = sim.add("wanted.txt", parent: first)
    sim.add("private.txt", parent: second)
    sim.omitListingIdentity = missingIdentity
    sim.propertyListAllObjects = true
    let device = try MTPDevice(transport: sim)
    #expect(try device.children(storage: sim.storageID, parent: first).map(\.handle) == [wanted])
    #expect(Set(try device.children(storage: sim.storageID).map(\.handle)) == [first, second])
    #expect(sim.violations.isEmpty)
  }

  @Test func unsupportedBatchingFallsBackButAccessErrorsPropagate() throws {
    let unsupported = SimulatedDevice()
    unsupported.add("file.txt")
    let device = try MTPDevice(transport: unsupported)
    unsupported.forcedResponses[.getObjectPropList] = .operationNotSupported
    #expect(try device.children(storage: unsupported.storageID).map(\.name) == ["file.txt"])
    _ = try device.children(storage: unsupported.storageID, refresh: true)
    #expect(unsupported.operationCounts[.getObjectPropList] == 1)

    let denied = SimulatedDevice()
    denied.add("private.txt")
    let deniedDevice = try MTPDevice(transport: denied)
    denied.forcedResponses[.getObjectPropList] = .accessDenied
    #expect(throws: MTPError.response(.accessDenied, operation: .getObjectPropList)) {
      _ = try deniedDevice.children(storage: denied.storageID)
    }
    #expect(denied.operationCounts[.getObjectInfo, default: 0] == 0)
    #expect(denied.operationCounts[.getObjectHandles, default: 0] == 0)
  }
}

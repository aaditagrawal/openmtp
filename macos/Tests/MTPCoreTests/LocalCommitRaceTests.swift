import Foundation
import Testing

@testable import MTPCore

@Suite("Exclusive local commit races")
struct LocalCommitRaceTests {
  private func directory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "local-commit-race-\(UUID())")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private func inode(_ url: URL) throws -> UInt64 {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    return try #require((attributes[.systemFileNumber] as? NSNumber)?.uint64Value)
  }

  @Test(arguments: [false, true])
  func replacementAfterValidationRestoresOrPreservesDisplacedCopy(pathReoccupied: Bool) throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let target = root.appendingPathComponent("target")
    let staged = root.appendingPathComponent("payload")
    let backup = root.appendingPathComponent("previous")
    let savedOriginal = root.appendingPathComponent("original-writer-backup")
    try Data("planned original".utf8).write(to: target)
    try Data("downloaded bytes".utf8).write(to: staged)
    let plannedInode = try inode(target)
    do {
      try LocalTransferCommit.commit(
        staged, to: target, backup: backup,
        matchesExpected: { try inode($0) == plannedInode },
        move: { source, destination in
          if source == target && destination == backup {
            // Another writer installs a different inode after final validation.
            try FileManager.default.moveItem(at: target, to: savedOriginal)
            try Data("newer writer bytes".utf8).write(to: target)
          }
          if source == backup && destination == target && pathReoccupied {
            try Data("third writer bytes".utf8).write(to: target)
          }
          try LocalTransferCommit.moveExclusive(source, destination)
        })
      Issue.record("The displaced destination must fail identity validation.")
    } catch TreeTransferError.recoveryRequired(let message) {
      #expect(pathReoccupied)
      #expect(message.contains(staged.path) && message.contains(backup.path))
    } catch TreeTransferError.destinationChanged(let path) {
      #expect(!pathReoccupied && path == target.path)
    }
    if pathReoccupied {
      #expect(try Data(contentsOf: target) == Data("third writer bytes".utf8))
      #expect(try Data(contentsOf: backup) == Data("newer writer bytes".utf8))
    } else {
      #expect(try Data(contentsOf: target) == Data("newer writer bytes".utf8))
      #expect(!FileManager.default.fileExists(atPath: backup.path))
    }
    #expect(try Data(contentsOf: savedOriginal) == Data("planned original".utf8))
    #expect(try Data(contentsOf: staged) == Data("downloaded bytes".utf8))
  }

  @Test func writerAtFinalCommitIsNeverOverwrittenByRollback() throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let target = root.appendingPathComponent("target")
    let staged = root.appendingPathComponent("payload")
    let backup = root.appendingPathComponent("previous")
    try Data("planned original".utf8).write(to: target)
    try Data("downloaded bytes".utf8).write(to: staged)
    let plannedInode = try inode(target)
    do {
      try LocalTransferCommit.commit(
        staged, to: target, backup: backup,
        matchesExpected: { try inode($0) == plannedInode },
        move: { source, destination in
          if source == staged && destination == target {
            try Data("concurrent writer bytes".utf8).write(to: target)
          }
          try LocalTransferCommit.moveExclusive(source, destination)
        })
      Issue.record("An occupied destination must prevent commit and rollback.")
    } catch TreeTransferError.recoveryRequired(let message) {
      #expect(message.contains(staged.path) && message.contains(backup.path))
    }
    #expect(try Data(contentsOf: target) == Data("concurrent writer bytes".utf8))
    #expect(try Data(contentsOf: backup) == Data("planned original".utf8))
    #expect(try Data(contentsOf: staged) == Data("downloaded bytes".utf8))
  }

  @Test func failedCommitRestoresOriginalOnlyWhenThePathIsVacant() throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let target = root.appendingPathComponent("target")
    let staged = root.appendingPathComponent("payload")
    let backup = root.appendingPathComponent("previous")
    try Data("planned original".utf8).write(to: target)
    try Data("downloaded bytes".utf8).write(to: staged)
    let plannedInode = try inode(target)
    #expect(throws: POSIXError(.EACCES)) {
      try LocalTransferCommit.commit(
        staged, to: target, backup: backup,
        matchesExpected: { try inode($0) == plannedInode },
        move: { source, destination in
          if source == staged && destination == target { throw POSIXError(.EACCES) }
          try LocalTransferCommit.moveExclusive(source, destination)
        })
    }
    #expect(try Data(contentsOf: target) == Data("planned original".utf8))
    #expect(try Data(contentsOf: staged) == Data("downloaded bytes".utf8))
    #expect(!FileManager.default.fileExists(atPath: backup.path))
  }

  @Test func aNewDestinationIsCommittedExclusively() throws {
    let root = try directory()
    defer { try? FileManager.default.removeItem(at: root) }
    let target = root.appendingPathComponent("target")
    let staged = root.appendingPathComponent("payload")
    let backup = root.appendingPathComponent("previous")
    try Data("downloaded bytes".utf8).write(to: staged)
    #expect(throws: POSIXError(.EEXIST)) {
      try LocalTransferCommit.commit(
        staged, to: target, backup: backup, matchesExpected: nil,
        move: { source, destination in
          try Data("concurrent writer bytes".utf8).write(to: target)
          try LocalTransferCommit.moveExclusive(source, destination)
        })
    }
    #expect(try Data(contentsOf: target) == Data("concurrent writer bytes".utf8))
    #expect(try Data(contentsOf: staged) == Data("downloaded bytes".utf8))
  }
}

import Foundation
import Testing

@testable import MTPCore

@Suite("Pipelined local I/O")
struct PipelinedIOTests {
  private func temporaryFile(_ contents: Data = Data()) throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("pipelined-\(UUID())")
    try contents.write(to: url)
    return url
  }

  private func pattern(_ count: Int) -> Data {
    Data((0..<count).map { UInt8(truncatingIfNeeded: $0 &* 31 &+ $0 >> 8) })
  }

  @Test(arguments: [1, 7, 4096, 65_537])
  func writerKeepsChunkOrder(chunkSize: Int) throws {
    let url = try temporaryFile()
    defer { try? FileManager.default.removeItem(at: url) }
    let handle = try FileHandle(forWritingTo: url)
    let expected = pattern(300_000)
    let writer = PipelinedFileWriter(handle: handle, depth: 2)
    var offset = 0
    while offset < expected.count {
      let end = min(offset + chunkSize, expected.count)
      try writer.write(expected.subdata(in: offset..<end))
      offset = end
    }
    try writer.finish()
    try handle.close()
    #expect(try Data(contentsOf: url) == expected)
  }

  @Test func writerReportsTheFirstFailureAndStopsWriting() throws {
    let url = try temporaryFile()
    defer { try? FileManager.default.removeItem(at: url) }
    // A read-only descriptor makes write(2) fail with EBADF on the writer queue.
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    let writer = PipelinedFileWriter(handle: handle, depth: 1)
    // Either a later write or finish() surfaces the failure; it is never lost.
    for _ in 0..<8 { if (try? writer.write(Data([1, 2, 3]))) == nil { break } }
    writer.drain()
    #expect(throws: (any Error).self) { try writer.finish() }
    #expect(try Data(contentsOf: url).isEmpty)
  }

  @Test(arguments: [(256, 3), (5, 1024), (4096, 4096), (1 << 20, 333_333), (64, 1)])
  func readerServesExactRequestedBytes(blockSize: Int, request: Int) throws {
    let expected = pattern(1_000_003)
    let url = try temporaryFile(expected)
    defer { try? FileManager.default.removeItem(at: url) }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    let reader = ReadAheadReader(file: handle, blockSize: blockSize)
    defer { reader.finish() }
    var received = Data()
    while true {
      let piece = try reader.read(request)
      if piece.isEmpty { break }
      #expect(piece.count <= request)
      received.append(piece)
    }
    #expect(received == expected)
    #expect(try reader.read(request).isEmpty)
  }
}

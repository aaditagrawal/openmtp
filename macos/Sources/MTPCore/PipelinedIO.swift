import Foundation

/// Overlaps local disk writes with the next USB bulk read.
///
/// A download used to write each chunk on the device queue before issuing the next
/// bulk IN transfer, so USB and disk latency added up. The writer copies chunks to a
/// private serial queue and only blocks the producer when `depth` chunks are already
/// waiting. Writes stay in order; the first error stops later writes and is rethrown
/// to the producer. `finish()` must run before the handle is synchronized or closed.
final class PipelinedFileWriter: @unchecked Sendable {
  private enum State {
    case accepting
    case failed(Error)
    case finished
  }

  private let handle: FileHandle
  private let queue = DispatchQueue(label: "openmtp.download-writer", qos: .userInitiated)
  private let slots: DispatchSemaphore
  private let group = DispatchGroup()
  private let lock = NSLock()
  private var state = State.accepting

  init(handle: FileHandle, depth: Int = 4) {
    self.handle = handle
    slots = DispatchSemaphore(value: max(1, depth))
  }

  private func currentError() -> Error? {
    lock.lock()
    defer { lock.unlock() }
    if case .failed(let error) = state { return error }
    return nil
  }

  func write(_ chunk: Data) throws {
    if let error = currentError() { throw error }
    guard !chunk.isEmpty else { return }
    slots.wait()
    if let error = currentError() {
      slots.signal()
      throw error
    }
    group.enter()
    queue.async { [self] in
      defer {
        slots.signal()
        group.leave()
      }
      guard currentError() == nil else { return }
      do {
        try handle.write(contentsOf: chunk)
      } catch {
        lock.lock()
        if case .accepting = state { state = .failed(error) }
        lock.unlock()
      }
    }
  }

  /// Waits for every queued write and rethrows the first failure.
  func finish() throws {
    group.wait()
    lock.lock()
    defer { lock.unlock() }
    switch state {
    case .failed(let error): throw error
    case .accepting, .finished: state = .finished
    }
  }

  /// Waits for queued writes without reporting their result. Used on failure paths
  /// so the handle is never closed or the partial file removed under a pending write.
  func drain() { group.wait() }
}

/// Reads an upload source one block ahead while the current block is on the wire.
///
/// `read(n)` serves exactly what `MTPOutgoingData` asks for from a local buffer and
/// keeps one fixed-size read of the file in flight on a private queue. Only one file
/// operation is ever outstanding, so the handle is never used concurrently.
final class ReadAheadReader: @unchecked Sendable {
  private enum Prefetch {
    case idle
    case inFlight(DispatchSemaphore)
    case endOfFile
  }

  private let file: FileHandle
  private let blockSize: Int
  private let queue = DispatchQueue(label: "openmtp.upload-reader", qos: .userInitiated)
  private var buffer = Data()
  private var prefetch = Prefetch.idle
  private var fetched: Result<Data, Error>?

  init(file: FileHandle, blockSize: Int = 1 << 20) {
    self.file = file
    self.blockSize = max(1, blockSize)
  }

  private func startPrefetch() {
    guard case .idle = prefetch else { return }
    let done = DispatchSemaphore(value: 0)
    prefetch = .inFlight(done)
    queue.async { [self] in
      fetched = Result { try file.read(upToCount: blockSize) ?? Data() }
      done.signal()
    }
  }

  private func awaitPrefetch() throws -> Data? {
    guard case .inFlight(let done) = prefetch else { return nil }
    done.wait()
    let result = fetched
    fetched = nil
    prefetch = .idle
    let block = try result?.get() ?? Data()
    if block.isEmpty { prefetch = .endOfFile }
    return block
  }

  func read(_ n: Int) throws -> Data {
    guard n > 0 else { return Data() }
    while buffer.count < n {
      if case .endOfFile = prefetch { break }
      startPrefetch()
      guard let block = try awaitPrefetch(), !block.isEmpty else { break }
      buffer.append(block)
    }
    if case .idle = prefetch { startPrefetch() }
    let take = min(n, buffer.count)
    let piece = buffer.prefix(take)
    buffer.removeFirst(take)
    return Data(piece)
  }

  /// Waits for an outstanding read so the caller can close the file safely.
  func finish() {
    if case .inFlight(let done) = prefetch {
      done.wait()
      done.signal()
    }
  }
}

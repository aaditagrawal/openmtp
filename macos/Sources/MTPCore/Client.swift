import Foundation

/// Async facade over `MTPDevice` for UI code.
///
/// MTP transfers are synchronous, blocking USB requests. Running them on Swift's
/// cooperative thread pool would starve it during a multi-gigabyte copy, so every
/// operation runs on one dedicated serial queue per device.
public final class MTPClient: Sendable {
  public let device: MTPDevice
  private let queue: DispatchQueue

  public init(device: MTPDevice, label: String = "openmtp.device") {
    self.device = device
    queue = DispatchQueue(label: label, qos: .userInitiated)
  }

  public func run<T: Sendable>(_ body: @escaping @Sendable (MTPDevice) throws -> T) async throws
    -> T
  {
    try await withCheckedThrowingContinuation { continuation in
      queue.async { [device] in
        continuation.resume(with: Result { try body(device) })
      }
    }
  }

  public func close() async {
    await withCheckedContinuation { continuation in
      queue.async { [device] in
        device.close()
        continuation.resume()
      }
    }
  }
}

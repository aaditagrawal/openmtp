import Foundation

#if canImport(Darwin)
  import Darwin
#else
  import Glibc
#endif

/// Validate the whole selection before scheduling any upload. A mixed file/folder
/// drop must never silently upload just the files. Rechecked by each core upload.
public enum UploadPreflight {
  /// Keep metadata and bytes attached to one verified descriptor. O_NONBLOCK
  /// prevents a path swapped for a FIFO from blocking before fstat can reject it.
  static func openRegularFile(_ url: URL) throws -> (
    file: FileHandle, size: UInt64, modified: Date
  ) {
    guard url.isFileURL else { throw MTPError.transport("Choose local regular files only.") }
    let descriptor = url.path.withCString {
      open($0, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
    }
    guard descriptor >= 0 else {
      throw MTPError.transport(
        "Cannot read \(url.lastPathComponent): \(POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO))"
      )
    }
    var ownsDescriptor = true
    defer { if ownsDescriptor { _ = close(descriptor) } }
    var info = stat()
    guard fstat(descriptor, &info) == 0 else {
      throw MTPError.transport(
        "Cannot inspect \(url.lastPathComponent): \(POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO))"
      )
    }
    guard info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), info.st_size >= 0 else {
      throw MTPError.transport("\(url.lastPathComponent) is not a regular file.")
    }
    #if canImport(Darwin)
      let modified = info.st_mtimespec
    #else
      let modified = info.st_mtim
    #endif
    let file = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    ownsDescriptor = false
    return (
      file, UInt64(info.st_size),
      Date(
        timeIntervalSince1970: Double(modified.tv_sec) + Double(modified.tv_nsec) / 1_000_000_000)
    )
  }

  public static func validate(_ urls: [URL]) throws {
    for url in urls {
      guard url.isFileURL else {
        throw MTPError.transport("Choose local regular files only.")
      }
      let attributes: [FileAttributeKey: Any]
      do {
        // lstat semantics also reject symbolic links, including links to folders.
        attributes = try FileManager.default.attributesOfItem(atPath: url.path)
      } catch {
        throw MTPError.transport("Cannot read \(url.lastPathComponent): \(error)")
      }
      guard attributes[.type] as? FileAttributeType == .typeRegular else {
        throw MTPError.transport(
          "\(url.lastPathComponent) is not a regular file. Folder uploads and symbolic links are not supported. Select files only."
        )
      }
    }
  }
}

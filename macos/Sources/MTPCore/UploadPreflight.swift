import Foundation

/// Validate the whole selection before scheduling any upload. A mixed file/folder
/// drop must never silently upload just the files. Rechecked by each core upload.
public enum UploadPreflight {
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

import AppKit
import SwiftUI

@MainActor
struct TransferQueueView: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  private var pendingCount: Int { model.transfers.filter { !$0.finished }.count }

  var body: some View {
    Group {
      if model.transfers.isEmpty {
        HStack(spacing: 10) {
          Image(systemName: "arrow.left.arrow.right")
            .foregroundStyle(.secondary).accessibilityHidden(true)
          Text("Ready to copy").fontWeight(.medium)
          Text("Select files in either pane, then choose Copy.")
            .foregroundStyle(.secondary).lineLimit(1)
          Spacer(minLength: 0)
        }
        .font(.callout).padding(.horizontal, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      } else {
        VStack(spacing: 0) {
          HStack(spacing: 8) {
            Label("Transfers", systemImage: "arrow.left.arrow.right").fontWeight(.semibold)
            Text(pendingCount > 0 ? "\(pendingCount) pending" : "No pending copies")
              .foregroundStyle(.secondary).monospacedDigit()
            Spacer(minLength: 8)
            if model.transfers.contains(where: { $0.finished }) {
              Button("Clear Finished") { model.clearFinishedTransfers() }
                .buttonStyle(.borderless).help("Remove finished copies from this list")
            }
          }
          .font(.callout).padding(.horizontal, 16).padding(.vertical, 12)
          Divider().padding(.horizontal, 16)
          ScrollView {
            LazyVStack(spacing: 0) {
              ForEach(model.transfers) { job in
                TransferRow(job: job)
                  .padding(.horizontal, 16).padding(.vertical, 12)
                if job.id != model.transfers.last?.id {
                  Divider().padding(.leading, 48).padding(.trailing, 16)
                }
              }
            }
          }
        }
      }
    }
    .background {
      let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
      if reduceTransparency {
        shape.fill(Color(nsColor: .controlBackgroundColor))
      } else {
        shape.fill(.regularMaterial)
      }
    }
    .overlay {
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .strokeBorder(.primary.opacity(0.08), lineWidth: 0.5)
        .allowsHitTesting(false)
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Transfers")
  }
}

@MainActor
private struct TransferRow: View {
  let job: AppModel.Transfer
  @EnvironmentObject private var model: AppModel

  private var symbol: String {
    switch job.state {
    case .completed: "checkmark.circle.fill"
    case .failed: "exclamationmark.circle.fill"
    case .cancelled: "minus.circle"
    default: job.direction == .upload ? "arrow.up.doc" : "arrow.down.doc"
    }
  }

  private var stateColor: Color {
    switch job.state {
    case .failed: .red
    case .completed: .green
    default: .secondary
    }
  }

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: symbol).font(.system(size: 18))
        .foregroundStyle(stateColor).frame(width: 20, height: 22)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 5) {
        HStack(spacing: 12) {
          Text(job.name).fontWeight(.medium).lineLimit(1).truncationMode(.middle)
          Spacer(minLength: 0)
          Text(job.state.rawValue.capitalized).font(.caption).foregroundStyle(stateColor)
        }
        Text(job.route).font(.caption).foregroundStyle(.secondary)
          .lineLimit(1).truncationMode(.middle)
          .help(job.sourcePaths.joined(separator: "\n") + "\n→ " + job.destination)
        if job.state == .running || job.state == .cancelling {
          if let fraction = job.fraction {
            ProgressView(value: fraction).accessibilityLabel("Copy progress")
          } else {
            ProgressView().progressViewStyle(.linear).accessibilityLabel("Copy in progress")
          }
          HStack(spacing: 12) {
            Text(
              "\(job.completedFiles) / \(job.totalFiles) files · \(transferBytes(job.done))\(job.total.map { " of " + transferBytes($0) } ?? "")"
            )
            Spacer(minLength: 0)
            if let speed = job.bytesPerSecond {
              Text("\(transferBytes(UInt64(max(0, speed))))/s")
            }
            if let remaining = job.remainingSeconds {
              Text("~\(Int(remaining / 60))m \(Int(remaining) % 60)s")
            }
          }.font(.caption2).foregroundStyle(.secondary).monospacedDigit()
          if !job.currentFile.isEmpty {
            Text(job.currentFile).font(.caption2).foregroundStyle(.secondary)
              .lineLimit(1).truncationMode(.middle)
          }
        } else if job.state == .completed {
          Text(
            "\(job.completedFiles) files · \(transferBytes(job.done))\(job.skippedFiles > 0 ? " · \(job.skippedFiles) skipped" : "")"
          ).font(.caption2).foregroundStyle(.secondary)
        }
        if let error = job.error {
          Text(error).font(.caption).foregroundStyle(job.state == .failed ? .red : .secondary)
            .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
      }
      HStack(spacing: 8) {
        if job.state == .failed || job.state == .cancelled || job.state == .waiting {
          TransferActionButton(title: "Retry Copy", symbol: "arrow.clockwise") {
            model.retryTransfer(job.id)
          }.disabled(!model.canRetryTransfer(job.id))
        }
        if !job.finished {
          TransferActionButton(title: "Cancel Copy", symbol: "xmark") {
            model.cancelTransfer(job.id)
          }
        }
      }.controlSize(.small)
    }
    .accessibilityElement(children: .contain)
  }
}

@MainActor
private struct TransferActionButton: View {
  let title: String
  let symbol: String
  let action: () -> Void

  var body: some View {
    if #available(macOS 26, *) {
      button.buttonStyle(.glass)
    } else {
      button.buttonStyle(.bordered)
    }
  }

  private var button: some View {
    Button(action: action) {
      Label(title, systemImage: symbol).labelStyle(.iconOnly)
    }.help(title)
  }
}

private func transferBytes(_ count: UInt64) -> String {
  ByteCountFormatter.string(fromByteCount: Int64(clamping: count), countStyle: .file)
}

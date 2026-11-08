import SwiftUI

/// Shared motion tokens. Every curve is an ease-out: it moves most of the distance
/// in the first frames, so a click gets visible feedback at once, then settles.
/// Nothing here runs longer than 300 ms.
enum Motion {
  /// Custom ease-out (close to easeOutQuint). Steeper at the start than the
  /// system `.easeOut`, so short durations still read as instant.
  static func easeOut(_ duration: Double) -> Animation {
    .timingCurve(0.22, 1, 0.36, 1, duration: duration)
  }
  /// Selection, hover and drop highlights.
  static let quick = easeOut(0.12)
  /// Content swaps, empty states and status indicators.
  static let standard = easeOut(0.2)
  /// Panels that change size or slide in, such as the transfer queue.
  static let panel = easeOut(0.26)
  /// One spinner revolution. The system indicator takes about a second.
  static let spinnerPeriod = 0.55

  /// Fades are kept under Reduce Motion; only movement is removed.
  static func fade(_ animation: Animation = standard) -> AnyTransition {
    .opacity.animation(animation)
  }
  static func slide(from edge: Edge, reduceMotion: Bool) -> AnyTransition {
    reduceMotion
      ? .opacity.animation(standard)
      : .move(edge: edge).combined(with: .opacity).animation(panel)
  }
}

extension View {
  /// `.animation(_:value:)` that turns movement off under Reduce Motion.
  func motion<V: Equatable>(_ animation: Animation, value: V) -> some View {
    modifier(MotionModifier(animation: animation, value: value))
  }
}

private struct MotionModifier<V: Equatable>: ViewModifier {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let animation: Animation
  let value: V
  func body(content: Content) -> some View {
    content.animation(reduceMotion ? nil : animation, value: value)
  }
}

/// A small indeterminate spinner that turns faster than the system one.
///
/// Rotation comes from the timeline clock instead of view state, so it needs no
/// `@State` and costs nothing while it is off screen. Under Reduce Motion it is a
/// static partial ring.
struct Spinner: View {
  var size: CGFloat = 14
  var label = "Loading"
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    TimelineView(.animation(minimumInterval: nil, paused: reduceMotion)) { context in
      let seconds = context.date.timeIntervalSinceReferenceDate
      let turn =
        seconds.truncatingRemainder(dividingBy: Motion.spinnerPeriod) / Motion.spinnerPeriod
      Circle()
        .trim(from: 0, to: 0.7)
        .stroke(
          Color.secondary,
          style: StrokeStyle(lineWidth: max(1.5, size * 0.14), lineCap: .round)
        )
        .rotationEffect(.degrees(reduceMotion ? 0 : turn * 360))
    }
    .frame(width: size, height: size)
    .padding(1)
    .accessibilityElement()
    .accessibilityLabel(label)
    .accessibilityAddTraits(.updatesFrequently)
  }
}

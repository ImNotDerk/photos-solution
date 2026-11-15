import SwiftUI
import Photos
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Authentic Apple Photos Horizontal Filmstrip Scrubber
/// Allows the user to smoothly slide their thumb or tap across thumbnails to compare shots.
public struct FilmstripScrubberView: View {
    @EnvironmentObject public var triageState: TriageState
    @EnvironmentObject public var photoKitManager: PhotoKitManager

    public init() {}

    public var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 5) {
                    ForEach(triageState.assets.indices, id: \.self) { index in
                        let asset = triageState.assets[index]
                        FilmstripThumbnailItem(
                            asset: asset,
                            isSelected: index == triageState.currentIndex,
                            decision: triageState.decision(for: asset)
                        )
                        .id(index)
                        .onTapGesture {
                            triageState.selectAsset(at: index)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
            .frame(height: 54)
            .onAppear {
                proxy.scrollTo(triageState.currentIndex, anchor: .center)
            }
            .onChange(of: triageState.currentIndex) { newIndex in
                withAnimation(.easeInOut(duration: 0.2)) {
                    proxy.scrollTo(newIndex, anchor: .center)
                }
            }
        }
    }
}

/// Individual Thumbnail Cell within the Scrubber
struct FilmstripThumbnailItem: View {
    @EnvironmentObject var photoKitManager: PhotoKitManager

    let asset: TriageAsset
    let isSelected: Bool
    let decision: TriageDecision

    @State private var thumbnailImage: UIImage? = nil

    var body: some View {
        let displayImage = thumbnailImage ?? photoKitManager.cachedThumbnail(for: asset)

        ZStack(alignment: .topTrailing) {
            Group {
                if let image = displayImage {
                    Image(platformImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    Color.slate800
                }
            }
            .frame(width: 44, height: 44)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(isSelected ? Color.white : Color.clear, lineWidth: 2)
            )
            .scaleEffect(isSelected ? 1.08 : 1.0)
            .shadow(color: isSelected ? Color.black.opacity(0.5) : Color.clear, radius: 4)

            // Decision Status Dot
            if decision != .unsorted {
                Circle()
                    .fill(dotColor(for: decision))
                    .frame(width: 8, height: 8)
                    .overlay(Circle().stroke(Color.black, lineWidth: 1))
                    .offset(x: 2, y: -2)
            }
        }
        .task(id: asset.id) {
            if let cached = photoKitManager.cachedThumbnail(for: asset) {
                thumbnailImage = cached
                return
            }
            thumbnailImage = await photoKitManager.loadThumbnail(
                for: asset,
                size: CGSize(width: 88, height: 88)
            )
        }
    }

    private func dotColor(for decision: TriageDecision) -> Color {
        switch decision {
        case .trash:
            return .triageTrash
        case .backupOnly:
            return .triageBackupOnly
        case .backupKeep:
            return .triageBackupKeep
        case .unsorted:
            return .clear
        }
    }
}

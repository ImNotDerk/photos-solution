import SwiftUI
import Photos

/// Native Apple iOS 18 EXIF & Backup Destination Sheet
public struct PhotoDetailsSheetView: View {
    @Environment(\.dismiss) private var dismiss
    let asset: TriageAsset
    let decision: TriageDecision
    let hardDriveRoot: String

    public init(asset: TriageAsset, decision: TriageDecision, hardDriveRoot: String = "/Volumes/PhotosHD") {
        self.asset = asset
        self.decision = decision
        self.hardDriveRoot = hardDriveRoot
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Header Summary
                    VStack(spacing: 4) {
                        Text(asset.originalFilename ?? asset.canonicalName)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.white)
                        Text(asset.formattedDate)
                            .font(.system(size: 13))
                            .foregroundColor(.white.opacity(0.6))
                    }
                    .padding(.top, 8)

                    // Section 1: Capture & Image Telemetry
                    VStack(spacing: 10) {
                        detailRow(title: "Dimensions", value: asset.formattedDimensions)
                        Divider().background(Color.white.opacity(0.1))
                        detailRow(title: "File Size", value: asset.formattedSize)
                        Divider().background(Color.white.opacity(0.1))
                        detailRow(title: "Format", value: asset.isVideo ? "Video (MOV/MP4)" : (asset.isLivePhoto ? "Live Photo (HEIF)" : "Photo (HEIF/JPEG)"))
                        if asset.isVideo, let duration = asset.formattedDuration {
                            Divider().background(Color.white.opacity(0.1))
                            detailRow(title: "Duration", value: duration)
                        }
                    }
                    .padding(14)
                    .background(Color.white.opacity(0.06))
                    .cornerRadius(14)

                    // Section 2: Backup Destination & Presets
                    VStack(spacing: 10) {
                        detailRow(title: "Backup Target", value: hardDriveRoot)
                        Divider().background(Color.white.opacity(0.1))
                        detailRow(title: "Resolved Subfolder", value: "\(asset.targetYear)/\(asset.targetMonth)/\(asset.canonicalName)")
                        Divider().background(Color.white.opacity(0.1))
                        HStack {
                            Text("Triage Status")
                                .font(.system(size: 14))
                                .foregroundColor(.white.opacity(0.8))
                            Spacer()
                            HStack(spacing: 4) {
                                Image(systemName: decision.iconName)
                                Text(decision.title)
                            }
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(decision.color)
                        }
                    }
                    .padding(14)
                    .background(Color.white.opacity(0.06))
                    .cornerRadius(14)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Details")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                }
            }
        }
        #if os(iOS)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        #endif
    }

    private func detailRow(title: String, value: String) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 14))
                .foregroundColor(.white.opacity(0.8))
            Spacer()
            Text(value)
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.white)
                .multilineTextAlignment(.trailing)
        }
    }
}

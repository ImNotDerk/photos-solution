import SwiftUI
import Photos
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Utilitarian Grid Triage View
/// Provides a high-density thumbnail grid with status badges, category filtering,
/// and batch multi-selection for bulk triage operations.
public struct GridTriageView: View {
    @EnvironmentObject public var triageState: TriageState
    @EnvironmentObject public var photoKitManager: PhotoKitManager

    public var onAssetSelected: ((TriageAsset) -> Void)?

    @State private var currentFilter: TriageFilter = .all
    @State private var isSelectMode: Bool = false
    @State private var selectedAssetIds: Set<String> = []

    private let columns = [
        GridItem(.adaptive(minimum: 96, maximum: 120), spacing: 4)
    ]

    public init(onAssetSelected: ((TriageAsset) -> Void)? = nil) {
        self.onAssetSelected = onAssetSelected
    }

    public var displayAssets: [TriageAsset] {
        triageState.filteredAssets(filter: currentFilter)
    }

    public var body: some View {
        ZStack {
            Color.slate950.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header & Batch Filter Bar
                filterHeaderBar

                // Thumbnail Grid
                if triageState.assets.isEmpty {
                    emptyBatchView
                } else if displayAssets.isEmpty {
                    emptyFilterView
                } else {
                    assetGridScrollView
                }

                // Bottom Bulk Action Bar (when in select mode)
                if isSelectMode {
                    bulkActionBar
                }
            }
        }
    }

    // MARK: - Header & Filter Bar

    private var filterHeaderBar: some View {
        VStack(spacing: 6) {
            // Mode & Select Toggle Row
            HStack {
                HStack(spacing: 4) {
                    Text("GRID:")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(.slate500)
                    Text("\(triageState.selectedMonth?.displayName ?? "NO BATCH")")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundColor(.consoleCyan)
                }

                Spacer()

                if !triageState.assets.isEmpty {
                    Button {
                        isSelectMode.toggle()
                        if !isSelectMode {
                            selectedAssetIds.removeAll()
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: isSelectMode ? "checkmark.circle.fill" : "checkmark.circle")
                                .font(.system(size: 11, weight: .bold))
                            Text(isSelectMode ? "DONE" : "SELECT")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                        }
                        .foregroundColor(isSelectMode ? .consoleCyan : .slate200)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(isSelectMode ? Color.consoleCyan.opacity(0.15) : Color.slate800)
                        .utilitarianBorder(color: isSelectMode ? .consoleCyan : .slate700, width: 1, cornerRadius: 3)
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.top, 8)

            // Segmented Filter Bar
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(TriageFilter.allCases) { filter in
                        filterTabButton(filter: filter)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
            }

            Rectangle()
                .fill(Color.slate800)
                .frame(height: 1)
        }
        .background(Color.slate900)
    }

    private func filterTabButton(filter: TriageFilter) -> some View {
        let isSelected = (currentFilter == filter)
        let count = count(for: filter)

        return Button {
            currentFilter = filter
        } label: {
            HStack(spacing: 4) {
                Text(filter.rawValue.uppercased())
                    .font(.system(size: 10, weight: .bold, design: .monospaced))

                Text("[\(count)]")
                    .font(.system(size: 9, weight: .regular, design: .monospaced))
            }
            .foregroundColor(isSelected ? .slate100 : .slate400)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(isSelected ? Color.slate700 : Color.slate800)
            .utilitarianBorder(
                color: isSelected ? .consoleCyan : .slate700,
                width: 1,
                cornerRadius: 3
            )
        }
    }

    private func count(for filter: TriageFilter) -> Int {
        switch filter {
        case .all:
            return triageState.totalCount
        case .unsorted:
            return triageState.unsortedCount
        case .trash:
            return triageState.trashCount
        case .backupOnly:
            return triageState.backupOnlyCount
        case .backupKeep:
            return triageState.backupKeepCount
        }
    }

    // MARK: - Asset Grid

    private var assetGridScrollView: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(displayAssets) { asset in
                    let decision = triageState.decision(for: asset)
                    let isSelected = selectedAssetIds.contains(asset.id)

                    GridThumbnailCell(
                        asset: asset,
                        decision: decision,
                        isSelectMode: isSelectMode,
                        isSelected: isSelected
                    )
                    .onTapGesture {
                        if isSelectMode {
                            toggleSelection(for: asset)
                        } else {
                            triageState.selectAsset(asset)
                            onAssetSelected?(asset)
                        }
                    }
                }
            }
            .padding(6)
        }
    }

    private func toggleSelection(for asset: TriageAsset) {
        if selectedAssetIds.contains(asset.id) {
            selectedAssetIds.remove(asset.id)
        } else {
            selectedAssetIds.insert(asset.id)
        }
    }

    // MARK: - Bulk Action Bar

    private var bulkActionBar: some View {
        VStack(spacing: 6) {
            Rectangle()
                .fill(Color.slate800)
                .frame(height: 1)

            // Select All / Deselect All Row
            HStack {
                Text("SELECTED: \(selectedAssetIds.count) OF \(displayAssets.count)")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundColor(.consoleCyan)

                Spacer()

                Button {
                    if selectedAssetIds.count == displayAssets.count {
                        selectedAssetIds.removeAll()
                    } else {
                        selectedAssetIds = Set(displayAssets.map { $0.id })
                    }
                } label: {
                    Text(selectedAssetIds.count == displayAssets.count ? "DESELECT ALL" : "SELECT ALL")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundColor(.slate300)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 4)

            // Bulk Assignment Buttons
            HStack(spacing: 6) {
                bulkButton(title: "🗑️ TRASH", decision: .trash, color: .triageTrash)
                bulkButton(title: "💾 HD ONLY", decision: .backupOnly, color: .triageBackupOnly)
                bulkButton(title: "💾+📱 KEEP", decision: .backupKeep, color: .triageBackupKeep)
                bulkButton(title: "↩ UNSORT", decision: .unsorted, color: .slate400)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 6)
        }
        .background(Color.slate900)
    }

    private func bulkButton(title: String, decision: TriageDecision, color: Color) -> some View {
        Button {
            for id in selectedAssetIds {
                triageState.setDecision(assetId: id, decision: decision)
            }
            selectedAssetIds.removeAll()
            isSelectMode = false
        } label: {
            Text(title)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(color)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(Color.slate800)
                .utilitarianBorder(color: color.opacity(0.6), width: 1, cornerRadius: 3)
        }
        .disabled(selectedAssetIds.isEmpty)
        .opacity(selectedAssetIds.isEmpty ? 0.4 : 1.0)
    }

    // MARK: - Empty States

    private var emptyBatchView: some View {
        VStack(spacing: 10) {
            Spacer()
            Image(systemName: "square.grid.2x2")
                .font(.system(size: 30))
                .foregroundColor(.slate600)
            Text("NO BATCH LOADED")
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundColor(.slate300)
            Text("Select a month to inspect thumbnails.")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.slate500)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyFilterView: some View {
        VStack(spacing: 10) {
            Spacer()
            Text("NO ITEMS IN '\(currentFilter.rawValue.uppercased())'")
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundColor(.slate400)
            Text("Change filter category above to view other assets.")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.slate600)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Grid Thumbnail Cell

public struct GridThumbnailCell: View {
    public let asset: TriageAsset
    public let decision: TriageDecision
    public let isSelectMode: Bool
    public let isSelected: Bool

    @State private var thumbnail: UIImage? = nil

    public init(
        asset: TriageAsset,
        decision: TriageDecision,
        isSelectMode: Bool,
        isSelected: Bool
    ) {
        self.asset = asset
        self.decision = decision
        self.isSelectMode = isSelectMode
        self.isSelected = isSelected
    }

    public var body: some View {
        ZStack(alignment: .topTrailing) {
            // Thumbnail Image Canvas
            ZStack {
                Color.slate900

                if let image = thumbnail {
                    Image(platformImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    ProgressView()
                        .scaleEffect(0.6)
                        .tint(.slate500)
                }
            }
            .frame(height: 100)
            .clipped()

            // Status Border Badge (Left side)
            VStack {
                Spacer()
                HStack(spacing: 2) {
                    if decision != .unsorted {
                        HStack(spacing: 3) {
                            Image(systemName: decision.iconName)
                                .font(.system(size: 8, weight: .bold))
                            Text(decision.shortTitle.uppercased())
                                .font(.system(size: 8, weight: .bold, design: .monospaced))
                        }
                        .foregroundColor(decision.color)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 2)
                        .background(Color.slate950.opacity(0.85))
                        .utilitarianBorder(color: decision.color, width: 1, cornerRadius: 2)
                    }

                    Spacer()

                    if asset.isVideo {
                        Text(asset.formattedDuration ?? "VID")
                            .font(.system(size: 8, weight: .bold, design: .monospaced))
                            .foregroundColor(.slate200)
                            .padding(.horizontal, 3)
                            .padding(.vertical, 1)
                            .background(Color.slate950.opacity(0.8))
                    }
                }
                .padding(3)
            }

            // Selection Checkmark (in Multi-select mode)
            if isSelectMode {
                ZStack {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(isSelected ? Color.consoleCyan : Color.slate950.opacity(0.7))
                        .frame(width: 20, height: 20)
                        .overlay(
                            RoundedRectangle(cornerRadius: 2)
                                .stroke(isSelected ? Color.consoleCyan : Color.slate600, lineWidth: 1)
                        )

                    if isSelected {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.slate950)
                    }
                }
                .padding(4)
            }
        }
        .utilitarianBorder(
            color: isSelected ? .consoleCyan : (decision != .unsorted ? decision.color.opacity(0.6) : .slate800),
            width: isSelected ? 2 : 1,
            cornerRadius: 2
        )
        .task(id: asset.id) {
            let img = await PhotoKitManager.shared.loadThumbnail(for: asset)
            thumbnail = img
        }
    }
}

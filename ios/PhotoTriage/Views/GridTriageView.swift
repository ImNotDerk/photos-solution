import SwiftUI
import Photos
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Represents a calendar day grouping of triage assets.
public struct DailyAssetSection: Identifiable, Sendable, Equatable {
    public let id: String
    public let date: Date
    public let title: String
    public let assets: [TriageAsset]

    public init(id: String, date: Date, title: String, assets: [TriageAsset]) {
        self.id = id
        self.date = date
        self.title = title
        self.assets = assets
    }
}

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

    private static let dayHeaderFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMM d, yyyy"
        return formatter
    }()

    public init(onAssetSelected: ((TriageAsset) -> Void)? = nil) {
        self.onAssetSelected = onAssetSelected
    }

    public var displayAssets: [TriageAsset] {
        triageState.filteredAssets(filter: currentFilter)
    }

    public func groupedDailySections(for assets: [TriageAsset]) -> [DailyAssetSection] {
        guard !assets.isEmpty else { return [] }

        let calendar = Calendar.current
        let fallbackDate = Date()
        var dict: [Date: [TriageAsset]] = [:]
        var orderedDays: [Date] = []

        for asset in assets {
            let dayDate = calendar.startOfDay(for: asset.creationDate ?? fallbackDate)
            if dict[dayDate] == nil {
                orderedDays.append(dayDate)
            }
            dict[dayDate, default: []].append(asset)
        }

        return orderedDays.compactMap { dayDate in
            guard let dayAssets = dict[dayDate], !dayAssets.isEmpty else { return nil }
            let id = String(Int(dayDate.timeIntervalSince1970))
            let title = Self.dayHeaderFormatter.string(from: dayDate)
            return DailyAssetSection(id: id, date: dayDate, title: title, assets: dayAssets)
        }
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
        VStack(spacing: 8) {
            // Mode & Select Toggle Row
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "square.grid.2x2.fill")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(.consoleCyan)
                    Text("\(triageState.selectedMonth?.displayName ?? "NO BATCH")")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundColor(.slate100)
                }

                Spacer()

                if !triageState.assets.isEmpty {
                    Button {
                        triggerHapticFeedback(0)
                        isSelectMode.toggle()
                        if !isSelectMode {
                            selectedAssetIds.removeAll()
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: isSelectMode ? "checkmark.circle.fill" : "checkmark.circle")
                                .font(.system(size: 13, weight: .bold))
                            Text(isSelectMode ? "DONE" : "SELECT")
                                .font(.system(size: 13, weight: .bold, design: .rounded))
                        }
                        .foregroundColor(isSelectMode ? .consoleCyan : .slate100)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(isSelectMode ? Color.consoleCyan.opacity(0.2) : Color.slate800)
                        .cornerRadius(8)
                        .utilitarianBorder(color: isSelectMode ? .consoleCyan : .slate700, width: 1, cornerRadius: 8)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 8)

            // Segmented Filter Bar
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(TriageFilter.allCases) { filter in
                        filterTabButton(filter: filter)
                    }
                }
                .padding(.horizontal, 14)
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
            triggerHapticFeedback(0)
            currentFilter = filter
        } label: {
            HStack(spacing: 5) {
                Text(filter.rawValue.uppercased())
                    .font(.system(size: 12, weight: .bold, design: .rounded))

                Text("[\(count)]")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
            }
            .foregroundColor(isSelected ? .slate100 : .slate400)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(isSelected ? Color.slate700 : Color.slate800)
            .cornerRadius(8)
            .utilitarianBorder(
                color: isSelected ? .consoleCyan : .slate700,
                width: 1,
                cornerRadius: 8
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
        let dailySections = groupedDailySections(for: displayAssets)

        return ScrollView {
            LazyVGrid(columns: columns, spacing: 4, pinnedViews: [.sectionHeaders]) {
                ForEach(dailySections) { section in
                    Section(header: DaySectionHeader(title: section.title, count: section.assets.count)) {
                        ForEach(section.assets) { asset in
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
            HStack(spacing: 8) {
                bulkButton(title: "🗑️ TRASH", decision: .trash, color: .triageTrash)
                bulkButton(title: "💾 HD ONLY", decision: .backupOnly, color: .triageBackupOnly)
                bulkButton(title: "💾+📱 KEEP", decision: .backupKeep, color: .triageBackupKeep)
                bulkButton(title: "↩ UNSORT", decision: .unsorted, color: .slate400)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
        .background(Color.slate900)
    }

    private func bulkButton(title: String, decision: TriageDecision, color: Color) -> some View {
        Button {
            triggerHapticFeedback(1)
            for id in selectedAssetIds {
                triageState.setDecision(assetId: id, decision: decision)
            }
            selectedAssetIds.removeAll()
            isSelectMode = false
        } label: {
            Text(title)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundColor(color)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
                .background(Color.slate800)
                .cornerRadius(8)
                .utilitarianBorder(color: color.opacity(0.6), width: 1, cornerRadius: 8)
        }
        .disabled(selectedAssetIds.isEmpty)
        .opacity(selectedAssetIds.isEmpty ? 0.4 : 1.0)
    }

    // MARK: - Empty States

    private var emptyBatchView: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "square.grid.2x2")
                .font(.system(size: 36))
                .foregroundColor(.slate600)
            Text("NO BATCH LOADED")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundColor(.slate200)
            Text("Select a month to inspect thumbnails.")
                .font(.system(size: 12, design: .rounded))
                .foregroundColor(.slate400)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyFilterView: some View {
        VStack(spacing: 12) {
            Spacer()
            Text("NO ITEMS IN '\(currentFilter.rawValue.uppercased())'")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundColor(.slate300)
            Text("Change filter category above to view other assets.")
                .font(.system(size: 12, design: .rounded))
                .foregroundColor(.slate500)
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
            .frame(height: 105)
            .cornerRadius(8)
            .clipped()

            // Status Border Badge (Left side)
            VStack {
                Spacer()
                HStack(spacing: 2) {
                    if decision != .unsorted {
                        HStack(spacing: 3) {
                            Image(systemName: decision.iconName)
                                .font(.system(size: 9, weight: .bold))
                            Text(decision.shortTitle.uppercased())
                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                        }
                        .foregroundColor(decision.color)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 3)
                        .background(Color.slate950.opacity(0.85))
                        .cornerRadius(4)
                        .utilitarianBorder(color: decision.color, width: 1, cornerRadius: 4)
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

/// Sticky Section Header displaying the capture date and asset count for daily grouping.
public struct DaySectionHeader: View {
    public let title: String
    public let count: Int

    public init(title: String, count: Int) {
        self.title = title
        self.count = count
    }

    public var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "calendar")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.consoleCyan)

            Text(title)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundColor(.slate100)

            Spacer()

            Text("\(count) \(count == 1 ? "ITEM" : "ITEMS")")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.slate400)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.slate800)
                .cornerRadius(4)
        }
        .padding(.horizontal, 10)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .background(Color.slate950.opacity(0.96))
        .utilitarianBorder(color: Color.slate800, width: 1, cornerRadius: 4)
        .padding(.bottom, 2)
    }
}

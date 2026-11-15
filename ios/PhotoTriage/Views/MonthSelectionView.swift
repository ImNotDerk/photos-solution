import SwiftUI
import Photos

/// Utilitarian Month Selection View
/// Lists all Year-Month groups discovered in the Camera Roll with photo counts
/// and provides one-tap entry into focused triage.
public struct MonthSelectionView: View {
    @EnvironmentObject public var triageState: TriageState
    @EnvironmentObject public var photoKitManager: PhotoKitManager
    @Environment(\.dismiss) private var dismiss

    public var onMonthSelected: ((YearMonthGroup) -> Void)?

    @State private var hasAppeared = false
    @State private var searchText = ""

    public init(onMonthSelected: ((YearMonthGroup) -> Void)? = nil) {
        self.onMonthSelected = onMonthSelected
    }

    public var filteredMonths: [YearMonthGroup] {
        if searchText.trimmingCharacters(in: .whitespaces).isEmpty {
            return photoKitManager.months
        }
        let lower = searchText.lowercased()
        return photoKitManager.months.filter { group in
            group.displayName.lowercased().contains(lower) ||
            group.monthName.lowercased().contains(lower) ||
            String(group.year).contains(lower)
        }
    }

    public var totalAssetsInArchive: Int {
        photoKitManager.months.reduce(0) { $0 + $1.assetCount }
    }

    public var body: some View {
        ZStack {
            Color.slate950.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header Terminal Bar
                headerBar

                // Content
                if photoKitManager.isLoading && photoKitManager.months.isEmpty {
                    loadingView
                } else if !photoKitManager.isAuthorized && photoKitManager.authorizationStatus != .notDetermined {
                    permissionRequiredView
                } else if photoKitManager.months.isEmpty {
                    emptyArchiveView
                } else {
                    monthListView
                }
            }
        }
        .task {
            if !hasAppeared {
                hasAppeared = true
                if !photoKitManager.isAuthorized {
                    await photoKitManager.requestAuthorization()
                }
                if photoKitManager.months.isEmpty {
                    await photoKitManager.fetchMonths()
                }
            }
        }
    }

    // MARK: - Header Bar

    private var headerBar: some View {
        VStack(spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("ARCHIVE // DIRECTORY")
                        .font(.system(size: 14, weight: .bold, design: .monospaced))
                        .foregroundColor(.consoleCyan)

                    Text("\(photoKitManager.months.count) MONTHS DETECTED • \(totalAssetsInArchive) ASSETS")
                        .font(.system(size: 11, weight: .regular, design: .monospaced))
                        .foregroundColor(.slate400)
                }

                Spacer()

                Button {
                    Task {
                        await photoKitManager.fetchMonths()
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 11, weight: .bold))
                        Text("RE-SCAN")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                    }
                    .foregroundColor(.slate200)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(Color.slate800)
                    .utilitarianBorder(color: .slate700, width: 1, cornerRadius: 3)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 6)

            Rectangle()
                .fill(Color.slate800)
                .frame(height: 1)
        }
        .background(Color.slate900)
    }

    // MARK: - Month List View

    private var monthListView: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(filteredMonths) { group in
                    let isCurrent = triageState.selectedMonth?.id == group.id
                    Button {
                        selectMonth(group)
                    } label: {
                        monthRow(group: group, isCurrent: isCurrent)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(12)
        }
    }

    private func monthRow(group: YearMonthGroup, isCurrent: Bool) -> some View {
        HStack(spacing: 12) {
            // Calendar icon / Year block
            VStack(alignment: .center, spacing: 1) {
                Text(String(group.year))
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundColor(isCurrent ? .consoleCyan : .slate400)

                Text(group.monthName.prefix(3))
                    .font(.system(size: 14, weight: .black, design: .monospaced))
                    .foregroundColor(isCurrent ? .slate100 : .slate200)
            }
            .frame(width: 54, height: 44)
            .background(isCurrent ? Color.slate800 : Color.slate950)
            .utilitarianBorder(color: isCurrent ? .consoleCyan : .slate700, width: 1, cornerRadius: 2)

            // Month description & photo count
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(group.displayName)
                        .font(.system(size: 14, weight: .bold, design: .monospaced))
                        .foregroundColor(.slate100)

                    if isCurrent {
                        Text("[ACTIVE]")
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundColor(.consoleCyan)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Color.consoleCyan.opacity(0.15))
                            .utilitarianBorder(color: .consoleCyan, width: 1, cornerRadius: 2)
                    }
                }

                Text("\(group.assetCount) items • /Volumes/HD/\(group.year)/\(group.monthName)/")
                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                    .foregroundColor(.slate400)
                    .lineLimit(1)
            }

            Spacer()

            // Chevron
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundColor(isCurrent ? .consoleCyan : .slate500)
        }
        .padding(10)
        .background(isCurrent ? Color.slate800.opacity(0.8) : Color.slate900)
        .utilitarianBorder(color: isCurrent ? .consoleCyan : .slate800, width: 1, cornerRadius: 4)
    }

    private func selectMonth(_ group: YearMonthGroup) {
        let assets = photoKitManager.fetchAssets(for: group)
        triageState.loadMonth(group, assets: assets)
        onMonthSelected?(group)
        dismiss()
    }

    // MARK: - Status States

    private var loadingView: some View {
        VStack(spacing: 12) {
            Spacer()
            ProgressView()
                .tint(.consoleCyan)
            Text("SCANNING PHOTO LIBRARY INDEX...")
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundColor(.slate300)
            Text("Parsing Camera Roll assets into calendar month groups")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.slate500)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var permissionRequiredView: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "lock.shield")
                .font(.system(size: 36))
                .foregroundColor(.triageTrash)

            Text("PHOTOKIT ACCESS REQUIRED")
                .font(.system(size: 14, weight: .bold, design: .monospaced))
                .foregroundColor(.slate100)

            Text("PhotoTriage requires Full Access to your photo library to read calendar months, extract media bundles for backup, and safely purge triaged items.")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.slate400)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            Button {
                Task {
                    await photoKitManager.requestAuthorization()
                    if photoKitManager.isAuthorized {
                        await photoKitManager.fetchMonths()
                    }
                }
            } label: {
                Text("GRANT LIBRARY ACCESS")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundColor(.slate100)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color.slate800)
                    .utilitarianBorder(color: .slate600, width: 1, cornerRadius: 3)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyArchiveView: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 32))
                .foregroundColor(.slate600)

            Text("NO CAMERA ROLL ASSETS")
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundColor(.slate300)

            Text("No photos or videos were found in your library.")
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.slate500)

            Button {
                Task {
                    await photoKitManager.fetchMonths()
                }
            } label: {
                Text("REFRESH")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundColor(.slate200)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.slate800)
                    .utilitarianBorder(color: .slate700, width: 1, cornerRadius: 3)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

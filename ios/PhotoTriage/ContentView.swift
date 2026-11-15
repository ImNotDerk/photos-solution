import SwiftUI

// MARK: - Navigation Mode

public enum TriageAppTab: String, CaseIterable, Identifiable, Sendable {
    case single = "Single"
    case grid = "Grid"
    case backup = "Backup"
    case settings = "Settings"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .single: return "Triage"
        case .grid: return "Library"
        case .backup: return "Backup"
        case .settings: return "Settings"
        }
    }

    public var iconName: String {
        switch self {
        case .single: return "photo.fill.on.rectangle.fill"
        case .grid: return "square.grid.2x2.fill"
        case .backup: return "externaldrive.badge.icloud"
        case .settings: return "gearshape.fill"
        }
    }
}

/// Utilitarian Main Content Container
/// Hosts top month-selection banner, segmented tab bar, and views:
/// SingleTriageView, GridTriageView, BackupProgressView, and SettingsView.
public struct ContentView: View {
    @EnvironmentObject public var triageState: TriageState
    @EnvironmentObject public var networkManager: NetworkManager
    @EnvironmentObject public var photoKitManager: PhotoKitManager

    @State private var selectedTab: TriageAppTab = .single
    @State private var showingMonthSheet: Bool = false

    public init() {}

    public var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Top Global System Bar (shown on Grid, Backup, Settings)
                if selectedTab != .single {
                    globalHeaderBar
                }

                // Active Mode View
                ZStack {
                    switch selectedTab {
                    case .single:
                        SingleTriageView(onDismissToGrid: {
                            selectedTab = .grid
                        })
                    case .grid:
                        GridTriageView { _ in
                            // When user selects asset in grid, switch to Single view
                            selectedTab = .single
                        }
                    case .backup:
                        BackupProgressView()
                    case .settings:
                        SettingsView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                // Bottom Segmented Navigation Bar (shown on Grid, Backup, Settings)
                if selectedTab != .single {
                    segmentedNavigationBar
                }
            }
        }
        .sheet(isPresented: $showingMonthSheet) {
            MonthSelectionView { _ in
                showingMonthSheet = false
            }
            .environmentObject(triageState)
            .environmentObject(photoKitManager)
        }
        .task {
            // Check network status on startup
            await networkManager.pingServer()
            if !photoKitManager.isAuthorized && photoKitManager.authorizationStatus == .notDetermined {
                _ = await photoKitManager.requestAuthorization()
            }
            if photoKitManager.isAuthorized {
                if photoKitManager.months.isEmpty {
                    _ = await photoKitManager.fetchMonths()
                }
                if let firstMonth = photoKitManager.months.first, triageState.selectedMonth == nil {
                    let assets = photoKitManager.fetchAssets(for: firstMonth)
                    triageState.loadMonth(firstMonth, assets: assets)
                }
            } else if photoKitManager.authorizationStatus == .denied || photoKitManager.authorizationStatus == .restricted {
                selectedTab = .grid
            }
        }
    }

    // MARK: - Global Header Bar

    private var globalHeaderBar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                // Month Selector Button (Apple Capsule Style)
                Button {
                    triggerHapticFeedback(0)
                    showingMonthSheet = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.blue)

                        Text(triageState.selectedMonth?.displayName ?? "SELECT MONTH")
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .foregroundColor(.white)

                        Image(systemName: "chevron.down")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.white.opacity(0.6))
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Color.white.opacity(0.12))
                    .clipShape(Capsule())
                }

                Spacer()

                // Progress Indicator (Apple Style)
                if triageState.totalCount > 0 {
                    HStack(spacing: 8) {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("\(triageState.triagedCount)/\(triageState.totalCount)")
                                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                .foregroundColor(.white)

                            Text("(\(Int(triageState.progressPercentage * 100))%)")
                                .font(.system(size: 10, weight: .regular, design: .monospaced))
                                .foregroundColor(.white.opacity(0.6))
                        }

                        // Smooth Apple Mini Progress Bar
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(Color.white.opacity(0.15))
                                .frame(width: 50, height: 4)

                            Capsule()
                                .fill(Color.blue)
                                .frame(width: max(4, 50 * CGFloat(triageState.progressPercentage)), height: 4)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.white.opacity(0.08))
                    .clipShape(Capsule())
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 8)

            // Apple Hairline Divider
            Rectangle()
                .fill(Color.white.opacity(0.12))
                .frame(height: 0.5)
        }
        .background(Color(red: 0.08, green: 0.08, blue: 0.09).opacity(0.95))
    }

    // MARK: - Native Apple Tab Bar

    private var segmentedNavigationBar: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(Color.white.opacity(0.12))
                .frame(height: 0.5)

            HStack(spacing: 0) {
                ForEach(TriageAppTab.allCases) { tab in
                    let isSelected = (selectedTab == tab)

                    Button {
                        triggerHapticFeedback(0)
                        selectedTab = tab
                    } label: {
                        VStack(spacing: 3) {
                            Image(systemName: tab.iconName)
                                .font(.system(size: 19, weight: isSelected ? .semibold : .regular))

                            Text(tab.title)
                                .font(.system(size: 10, weight: isSelected ? .semibold : .medium))
                        }
                        .foregroundColor(isSelected ? .blue : .white.opacity(0.5))
                        .frame(maxWidth: .infinity)
                        .padding(.top, 6)
                        .padding(.bottom, 6)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 12) // Inset for iPhone home indicator
            .background(Color(red: 0.08, green: 0.08, blue: 0.09).opacity(0.95))
        }
    }
}

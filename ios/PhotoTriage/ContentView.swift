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
        case .single: return "SINGLE"
        case .grid: return "GRID"
        case .backup: return "BACKUP"
        case .settings: return "SETTINGS"
        }
    }

    public var iconName: String {
        switch self {
        case .single: return "rectangle.fill.on.rectangle.fill"
        case .grid: return "square.grid.2x2"
        case .backup: return "externaldrive.badge.icloud"
        case .settings: return "slider.horizontal.3"
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
            Color.slate950.ignoresSafeArea()

            VStack(spacing: 0) {
                // Top Global System Bar
                globalHeaderBar

                // Active Mode View
                ZStack {
                    switch selectedTab {
                    case .single:
                        SingleTriageView()
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

                // Bottom Tactile Segmented Navigation Bar
                segmentedNavigationBar
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
            if triageState.selectedMonth == nil && photoKitManager.months.isEmpty {
                if photoKitManager.isAuthorized {
                    let months = await photoKitManager.fetchMonths()
                    if let firstMonth = months.first {
                        let assets = photoKitManager.fetchAssets(for: firstMonth)
                        triageState.loadMonth(firstMonth, assets: assets)
                    }
                }
            }
        }
    }

    // MARK: - Global Header Bar

    private var globalHeaderBar: some View {
        VStack(spacing: 4) {
            HStack(spacing: 8) {
                // Month Selector Button
                Button {
                    showingMonthSheet = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.consoleCyan)

                        Text(triageState.selectedMonth?.displayName ?? "SELECT MONTH")
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundColor(.slate100)

                        Image(systemName: "chevron.down")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundColor(.slate400)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(Color.slate800)
                    .utilitarianBorder(color: .slate700, width: 1, cornerRadius: 3)
                }

                Spacer()

                // High-Density Progress Telemetry
                if triageState.totalCount > 0 {
                    HStack(spacing: 4) {
                        Text("\(triageState.triagedCount)/\(triageState.totalCount)")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundColor(.slate200)

                        Text("(\(Int(triageState.progressPercentage * 100))%)")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.consoleCyan)
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 4)
                    .background(Color.slate900)
                    .utilitarianBorder(color: .slate800, width: 1, cornerRadius: 2)
                }
            }
            .padding(.horizontal, 10)
            .padding(.top, 8)
            .padding(.bottom, 4)

            // 1px Separator
            Rectangle()
                .fill(Color.slate800)
                .frame(height: 1)
        }
        .background(Color.slate900)
    }

    // MARK: - Segmented Navigation Bar

    private var segmentedNavigationBar: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(Color.slate800)
                .frame(height: 1)

            HStack(spacing: 4) {
                ForEach(TriageAppTab.allCases) { tab in
                    let isSelected = (selectedTab == tab)

                    Button {
                        selectedTab = tab
                    } label: {
                        VStack(spacing: 3) {
                            Image(systemName: tab.iconName)
                                .font(.system(size: 13, weight: .bold))

                            Text(tab.title)
                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                        }
                        .foregroundColor(isSelected ? .consoleCyan : .slate400)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(isSelected ? Color.slate800 : Color.slate950)
                        .utilitarianBorder(color: isSelected ? .consoleCyan.opacity(0.8) : .clear, width: 1, cornerRadius: 3)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .background(Color.slate950)
        }
    }
}

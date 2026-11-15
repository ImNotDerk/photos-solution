import Foundation
import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// MARK: - Triage Action (for Undo Stack)

/// Represents a recorded triage mutation that can be undone in reverse chronological order.
public struct TriageAction: Equatable, Sendable {
    public let assetId: String
    public let previousDecision: TriageDecision
    public let newDecision: TriageDecision
    public let assetIndex: Int?
    public let timestamp: Date

    public init(
        assetId: String,
        previousDecision: TriageDecision,
        newDecision: TriageDecision,
        assetIndex: Int? = nil,
        timestamp: Date = Date()
    ) {
        self.assetId = assetId
        self.previousDecision = previousDecision
        self.newDecision = newDecision
        self.assetIndex = assetIndex
        self.timestamp = timestamp
    }
}

// MARK: - Triage Filter

/// Categories for filtering assets in Grid and List views.
public enum TriageFilter: String, CaseIterable, Identifiable, Sendable {
    case all = "All"
    case unsorted = "Unsorted"
    case trash = "Trash"
    case backupOnly = "HD Only"
    case backupKeep = "HD + Phone"

    public var id: String { rawValue }

    public var iconName: String {
        switch self {
        case .all:
            return "square.grid.2x2"
        case .unsorted:
            return "questionmark.circle"
        case .trash:
            return "trash"
        case .backupOnly:
            return "externaldrive"
        case .backupKeep:
            return "externaldrive.badge.plus"
        }
    }
}

// MARK: - Triage State

/// MainActor observable state holder managing current month batch triage,
/// active 1-by-1 index, decision dictionary, undo history, and background sync progress.
@MainActor
public final class TriageState: ObservableObject, Sendable {
    public static let shared = TriageState()

    // MARK: - Published Properties

    @Published public var selectedMonth: YearMonthGroup?
    @Published public var assets: [TriageAsset] = []
    @Published public var currentIndex: Int = 0
    @Published public var decisions: [String: TriageDecision] = [:]
    @Published public var undoStack: [TriageAction] = []
    @Published public var isSyncing: Bool = false
    @Published public var syncProgress: Double = 0.0
    @Published public var syncStatusText: String = ""

    // MARK: - Initialization

    public init(
        selectedMonth: YearMonthGroup? = nil,
        assets: [TriageAsset] = [],
        currentIndex: Int = 0,
        decisions: [String: TriageDecision] = [:]
    ) {
        self.selectedMonth = selectedMonth
        self.assets = assets
        self.currentIndex = currentIndex
        self.decisions = decisions
    }

    // MARK: - Batch & Asset Setup

    /// Loads a month group and its assets into state, resetting the triage index and history.
    public func loadMonth(_ month: YearMonthGroup, assets: [TriageAsset]) {
        self.selectedMonth = month
        self.assets = assets
        self.currentIndex = 0
        self.decisions = [:]
        self.undoStack = []
        self.isSyncing = false
        self.syncProgress = 0.0
        self.syncStatusText = ""
    }

    /// Resets all decisions and undo history for the current batch.
    public func resetDecisions() {
        self.decisions = [:]
        self.undoStack = []
        self.currentIndex = 0
    }

    /// Fully resets the triage state to empty.
    public func reset() {
        self.selectedMonth = nil
        self.assets = []
        self.currentIndex = 0
        self.decisions = [:]
        self.undoStack = []
        self.isSyncing = false
        self.syncProgress = 0.0
        self.syncStatusText = ""
    }

    // MARK: - Navigation

    /// The currently focused asset in 1-by-1 review mode.
    public var currentAsset: TriageAsset? {
        guard assets.indices.contains(currentIndex) else { return nil }
        return assets[currentIndex]
    }

    public var canGoNext: Bool {
        currentIndex < assets.count - 1
    }

    public var canGoPrevious: Bool {
        currentIndex > 0
    }

    public func goToNext() {
        if canGoNext {
            currentIndex += 1
        }
    }

    public func goToPrevious() {
        if canGoPrevious {
            currentIndex -= 1
        }
    }

    public func selectAsset(at index: Int) {
        guard assets.indices.contains(index) else { return }
        currentIndex = index
    }

    public func selectAsset(_ asset: TriageAsset) {
        if let idx = assets.firstIndex(where: { $0.id == asset.id }) {
            currentIndex = idx
        }
    }

    // MARK: - Decisions & Undo

    /// Retrieves the decision for an asset, defaulting to `.unsorted` if not yet triaged.
    public func decision(for asset: TriageAsset) -> TriageDecision {
        decisions[asset.id] ?? .unsorted
    }

    /// Retrieves the decision for an asset identifier, defaulting to `.unsorted`.
    public func decision(for assetId: String) -> TriageDecision {
        decisions[assetId] ?? .unsorted
    }

    /// Records a decision for the given asset identifier and pushes the change onto the undo stack.
    public func setDecision(assetId: String, decision: TriageDecision) {
        let prev = decisions[assetId] ?? .unsorted
        decisions[assetId] = decision

        let index = assets.firstIndex(where: { $0.id == assetId })
        let action = TriageAction(
            assetId: assetId,
            previousDecision: prev,
            newDecision: decision,
            assetIndex: index
        )
        undoStack.append(action)
    }

    /// Convenience helper to set decision using a `TriageAsset` model instance.
    public func setDecision(_ decision: TriageDecision, for asset: TriageAsset) {
        setDecision(assetId: asset.id, decision: decision)
    }

    /// Triages the current asset, appends to undo history, and optionally advances to the next asset.
    public func triageCurrent(as decision: TriageDecision, autoAdvance: Bool = true) {
        guard let asset = currentAsset else { return }
        setDecision(assetId: asset.id, decision: decision)
        if autoAdvance && canGoNext {
            goToNext()
        }
    }

    /// Whether an undo action is available.
    public var canUndo: Bool {
        !undoStack.isEmpty
    }

    /// Reverts the most recent decision and focuses the affected asset.
    @discardableResult
    public func undo() -> TriageAction? {
        guard let lastAction = undoStack.popLast() else { return nil }

        if lastAction.previousDecision == .unsorted {
            decisions.removeValue(forKey: lastAction.assetId)
        } else {
            decisions[lastAction.assetId] = lastAction.previousDecision
        }

        // Return focus to the undone asset so the user sees immediate feedback
        if let idx = lastAction.assetIndex, assets.indices.contains(idx) {
            currentIndex = idx
        } else if let foundIdx = assets.firstIndex(where: { $0.id == lastAction.assetId }) {
            currentIndex = foundIdx
        }

        return lastAction
    }

    // MARK: - Computed Counts

    public var totalCount: Int {
        assets.count
    }

    public var unsortedCount: Int {
        assets.filter { (decisions[$0.id] ?? .unsorted) == .unsorted }.count
    }

    public var trashCount: Int {
        assets.filter { decisions[$0.id] == .trash }.count
    }

    public var backupOnlyCount: Int {
        assets.filter { decisions[$0.id] == .backupOnly }.count
    }

    public var backupKeepCount: Int {
        assets.filter { decisions[$0.id] == .backupKeep }.count
    }

    public var triagedCount: Int {
        totalCount - unsortedCount
    }

    public var isComplete: Bool {
        totalCount > 0 && unsortedCount == 0
    }

    public var progressPercentage: Double {
        totalCount > 0 ? (Double(triagedCount) / Double(totalCount)) : 0.0
    }

    // MARK: - Filtering

    /// Filters current assets according to the selected `TriageFilter`.
    public func filteredAssets(filter: TriageFilter) -> [TriageAsset] {
        switch filter {
        case .all:
            return assets
        case .unsorted:
            return assets.filter { (decisions[$0.id] ?? .unsorted) == .unsorted }
        case .trash:
            return assets.filter { decisions[$0.id] == .trash }
        case .backupOnly:
            return assets.filter { decisions[$0.id] == .backupOnly }
        case .backupKeep:
            return assets.filter { decisions[$0.id] == .backupKeep }
        }
    }

    // MARK: - Hardware Safety Categorization

    /// Assets that require uploading to the Mac server / external hard drive (`backup_only` and `backup_keep`).
    public var assetsToUpload: [TriageAsset] {
        assets.filter { (decisions[$0.id] ?? .unsorted).requiresBackupUpload }
    }

    /// Assets to be permanently deleted from the iPhone Camera Roll (`trash` and `backup_only`).
    /// STRICT SAFETY INVARIANT: `backup_keep` assets are NEVER included in this list.
    public var assetsToDelete: [TriageAsset] {
        assets.filter { (decisions[$0.id] ?? .unsorted).shouldDeleteFromPhone }
    }

    /// Assets that must be preserved on the phone (`backup_keep` and `unsorted`).
    public var assetsToKeepOnPhone: [TriageAsset] {
        assets.filter { !(decisions[$0.id] ?? .unsorted).shouldDeleteFromPhone }
    }

    // MARK: - Sync State Management

    public func startSync(total: Int, initialText: String = "Starting sync...") {
        self.isSyncing = true
        self.syncProgress = 0.0
        self.syncStatusText = initialText
    }

    public func updateSync(completed: Int, total: Int, text: String) {
        self.isSyncing = true
        self.syncProgress = total > 0 ? (Double(completed) / Double(total)) : 0.0
        self.syncStatusText = text
    }

    public func finishSync(text: String = "Sync complete") {
        self.isSyncing = false
        self.syncProgress = 1.0
        self.syncStatusText = text
    }
}

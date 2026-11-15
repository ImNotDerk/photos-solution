import Foundation
import Photos
import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
public typealias UIImage = NSImage
#endif

// MARK: - Triage Decision

/// Represents the triage state/decision made by the user for a given asset.
/// Serialized raw values strictly match the Mac server API expectations:
/// - "unsorted"
/// - "trash"
/// - "backup_only"
/// - "backup_keep"
public enum TriageDecision: String, Codable, CaseIterable, Identifiable, Sendable {
    case unsorted = "unsorted"
    case trash = "trash"
    case backupOnly = "backup_only"
    case backupKeep = "backup_keep"

    public var id: String { rawValue }

    /// Human-readable title for UI buttons and badges.
    public var title: String {
        switch self {
        case .unsorted:
            return "Unsorted"
        case .trash:
            return "Trash"
        case .backupOnly:
            return "HD Only"
        case .backupKeep:
            return "HD + Phone"
        }
    }

    /// Short label for compact buttons and toolbars.
    public var shortTitle: String {
        switch self {
        case .unsorted:
            return "Unsorted"
        case .trash:
            return "Trash"
        case .backupOnly:
            return "HD Only"
        case .backupKeep:
            return "Keep"
        }
    }

    /// Descriptive sentence explaining what happens to the file.
    public var subtitle: String {
        switch self {
        case .unsorted:
            return "Awaiting review"
        case .trash:
            return "Delete permanently from iPhone"
        case .backupOnly:
            return "Backup to external HD, then delete from iPhone"
        case .backupKeep:
            return "Backup to external HD and keep on iPhone"
        }
    }

    /// SF Symbol icon name.
    public var iconName: String {
        switch self {
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

    /// High contrast utilitarian accent color.
    public var color: Color {
        switch self {
        case .unsorted:
            return Color(red: 0.55, green: 0.58, blue: 0.62) // Neutral slate gray
        case .trash:
            return Color(red: 0.95, green: 0.26, blue: 0.21) // Crimson red
        case .backupOnly:
            return Color(red: 0.98, green: 0.65, blue: 0.11) // Amber orange
        case .backupKeep:
            return Color(red: 0.18, green: 0.80, blue: 0.44) // Mint green
        }
    }

    /// Indicates whether the photo must be deleted from the iPhone Camera Roll after triage.
    /// ONLY `trash` and `backupOnly` are deleted. `backupKeep` is NEVER deleted.
    public var shouldDeleteFromPhone: Bool {
        switch self {
        case .trash, .backupOnly:
            return true
        case .unsorted, .backupKeep:
            return false
        }
    }

    /// Indicates whether the photo resources must be uploaded to the Mac server / hard drive.
    public var requiresBackupUpload: Bool {
        switch self {
        case .backupOnly, .backupKeep:
            return true
        case .unsorted, .trash:
            return false
        }
    }
}

// MARK: - Resource Role

/// The role of an individual resource file belonging to an asset bundle.
/// Serialized raw values strictly match the Mac server upload multipart field names:
/// - "primary": Required main photo (HEIC/JPG) or standalone video (MOV/MP4)
/// - "live_video": Optional companion video for Live Photo
/// - "edit_sidecar": Optional adjustment envelope (.AAE)
/// - "edited_render": Optional rendered full-size edit
public enum ResourceRole: String, Codable, CaseIterable, Identifiable, Sendable {
    case primary = "primary"
    case liveVideo = "live_video"
    case editSidecar = "edit_sidecar"
    case editedRender = "edited_render"

    public var id: String { rawValue }
}

// MARK: - Extracted Resource

/// An in-memory or on-disk resource extracted via `PHAssetResourceManager` ready for multipart upload.
/// Supports streaming via `fileURL` for large video assets to prevent RAM exhaustion.
public struct ExtractedResource: Identifiable, Sendable, Equatable, Hashable {
    public let id: UUID
    public let role: ResourceRole
    public let filename: String
    public let data: Data?
    public let fileURL: URL?
    public let mimeType: String

    public init(
        id: UUID = UUID(),
        role: ResourceRole,
        filename: String,
        data: Data? = nil,
        fileURL: URL? = nil,
        mimeType: String
    ) {
        self.id = id
        self.role = role
        self.filename = filename
        self.data = data
        self.fileURL = fileURL
        self.mimeType = mimeType
    }

    /// Convenience initializer for in-memory data.
    public init(
        id: UUID = UUID(),
        role: ResourceRole,
        filename: String,
        data: Data,
        mimeType: String
    ) {
        self.init(id: id, role: role, filename: filename, data: data, fileURL: nil, mimeType: mimeType)
    }

    /// Reads resource bytes either from in-memory buffer or from disk stream.
    public func loadData() throws -> Data {
        if let data = data {
            return data
        }
        if let fileURL = fileURL {
            return try Data(contentsOf: fileURL)
        }
        return Data()
    }

    /// Clean up any temporary file created on disk.
    public func cleanup() {
        if let fileURL = fileURL {
            try? FileManager.default.removeItem(at: fileURL)
        }
    }
}

// MARK: - Year Month Group

/// Represents a calendar month group for organizing Camera Roll assets (e.g. "2024 > MAY").
public struct YearMonthGroup: Identifiable, Hashable, Sendable, Comparable, Codable {
    public let year: Int
    public let month: Int
    public let monthName: String
    public let displayName: String
    public var assetCount: Int

    public var id: String {
        String(format: "%04d-%02d", year, month)
    }

    public static let monthNames: [String] = [
        "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
        "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
    ]

    public static func monthName(for month: Int) -> String {
        let clamped = max(1, min(12, month))
        return monthNames[clamped - 1]
    }

    public static func displayName(year: Int, month: Int) -> String {
        let name = monthName(for: month)
        return "\(year) > \(name)"
    }

    public init(year: Int, month: Int, assetCount: Int = 0) {
        self.year = year
        self.month = month
        self.monthName = Self.monthName(for: month)
        self.displayName = Self.displayName(year: year, month: month)
        self.assetCount = assetCount
    }

    public static func < (lhs: YearMonthGroup, rhs: YearMonthGroup) -> Bool {
        if lhs.year != rhs.year {
            return lhs.year < rhs.year
        }
        return lhs.month < rhs.month
    }
}

// MARK: - Triage Asset

/// Represents a single Camera Roll asset wrapping `PHAsset` with resolved metadata
/// and formatting helpers for presentation and Mac upload.
public struct TriageAsset: Identifiable, Hashable, Equatable, @unchecked Sendable {
    public let id: String
    public let phAsset: PHAsset
    public let canonicalName: String
    public let originalFilename: String?
    public let creationDate: Date?
    public let pixelWidth: Int
    public let pixelHeight: Int
    public let isLivePhoto: Bool
    public let isVideo: Bool
    public let duration: TimeInterval
    public var fileSize: Int64

    public let targetYear: String
    public let targetMonth: String
    public let capturedAtISO: String
    public let formattedDate: String
    public let formattedDimensions: String
    public var formattedSize: String
    public let formattedDuration: String?

    // Concurrency-safe formatters for Swift 6
    nonisolated(unsafe) private static let isoDateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let displayDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    public init(
        asset: PHAsset,
        originalFilename: String? = nil,
        fileSize: Int64 = 0
    ) {
        self.id = asset.localIdentifier
        self.phAsset = asset
        self.pixelWidth = asset.pixelWidth
        self.pixelHeight = asset.pixelHeight
        self.isLivePhoto = asset.mediaSubtypes.contains(.photoLive)
        self.isVideo = (asset.mediaType == .video)
        self.duration = asset.duration
        self.fileSize = fileSize

        let resolvedDate = asset.creationDate ?? Date()
        self.creationDate = asset.creationDate

        // Determine targetYear and targetMonth (using local calendar components)
        let calendar = Calendar.current
        let yearVal = calendar.component(.year, from: resolvedDate)
        let monthVal = calendar.component(.month, from: resolvedDate)
        self.targetYear = String(yearVal)
        self.targetMonth = YearMonthGroup.monthName(for: monthVal)

        self.capturedAtISO = Self.isoDateFormatter.string(from: resolvedDate)
        self.formattedDate = Self.displayDateFormatter.string(from: resolvedDate)
        self.formattedDimensions = "\(asset.pixelWidth) × \(asset.pixelHeight)"

        if fileSize > 0 {
            self.formattedSize = ByteCountFormatter.string(fromByteCount: fileSize, countStyle: .file)
        } else {
            self.formattedSize = "--"
        }

        if asset.mediaType == .video && asset.duration > 0 {
            let totalSeconds = Int(asset.duration.rounded())
            let minutes = totalSeconds / 60
            let seconds = totalSeconds % 60
            self.formattedDuration = String(format: "%d:%02d", minutes, seconds)
        } else {
            self.formattedDuration = nil
        }

        // Fast filename resolution: avoid synchronous PHAssetResource database lookup during batch listing
        var resolvedOriginalName = originalFilename
        if resolvedOriginalName == nil {
            resolvedOriginalName = asset.value(forKey: "filename") as? String
        }
        self.originalFilename = resolvedOriginalName

        if let filename = resolvedOriginalName, !filename.isEmpty {
            let nameWithoutExt = (filename as NSString).deletingPathExtension
            self.canonicalName = nameWithoutExt.isEmpty ? filename : nameWithoutExt
        } else {
            let sanitized = asset.localIdentifier
                .components(separatedBy: CharacterSet.alphanumerics.inverted)
                .joined(separator: "_")
            self.canonicalName = "IMG_\(sanitized.prefix(12))"
        }
    }

    public static func == (lhs: TriageAsset, rhs: TriageAsset) -> Bool {
        lhs.id == rhs.id
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

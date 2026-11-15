import Foundation
import Photos
import SwiftUI
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers
#endif
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// MARK: - Thread Safety Helpers

private final class StateBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false

    func tryResume() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if value { return false }
        value = true
        return true
    }
}

private final class BufferBox: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()

    func append(_ chunk: Data) {
        lock.lock()
        data.append(chunk)
        lock.unlock()
    }

    func getData() -> Data {
        lock.lock()
        defer { lock.unlock() }
        return data
    }
}

// MARK: - PhotoKit Error

public enum PhotoKitError: LocalizedError, Equatable {
    case notAuthorized
    case assetNotFound(String)
    case resourceExtractionFailed(String)
    case missingPrimaryResource(String)
    case deleteFailed(String)
    case unsafeDeleteAttempt(String)

    public var errorDescription: String? {
        switch self {
        case .notAuthorized:
            return "Photo library access is not authorized. Please grant Full Access in Settings."
        case .assetNotFound(let id):
            return "Asset with identifier '\(id)' was not found."
        case .resourceExtractionFailed(let details):
            return "Resource extraction failed: \(details)"
        case .missingPrimaryResource(let id):
            return "Asset '\(id)' does not contain a primary image or video resource."
        case .deleteFailed(let details):
            return "Failed to delete assets from library: \(details)"
        case .unsafeDeleteAttempt(let details):
            return "Safety guard triggered: \(details)"
        }
    }
}

// MARK: - PhotoKit Manager

/// Main actor and observable service responsible for querying Camera Roll photos,
/// loading thumbnails, extracting asset resources for multipart backup, and
/// safely executing deletions with hardware-safety guards.
@MainActor
public final class PhotoKitManager: ObservableObject {
    public static let shared = PhotoKitManager()

    @Published public var authorizationStatus: PHAuthorizationStatus = .notDetermined
    @Published public var months: [YearMonthGroup] = []
    @Published public var isLoading: Bool = false
    @Published public var errorMessage: String? = nil

    private let thumbnailCache = NSCache<NSString, UIImage>()
    private let imageManager = PHCachingImageManager()

    public init() {
        self.authorizationStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        self.thumbnailCache.countLimit = 500
    }

    /// Synchronously retrieves a cached thumbnail if already in memory, enabling 0ms frame-1 rendering.
    public func cachedThumbnail(for asset: TriageAsset) -> UIImage? {
        thumbnailCache.object(forKey: asset.id as NSString)
    }

    /// Checks if the application has photo library read/write authorization.
    public var isAuthorized: Bool {
        let currentStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        return currentStatus == .authorized || currentStatus == .limited
    }

    // MARK: - Authorization

    /// Prompts the user for PhotoKit read-write authorization and returns boolean success.
    @discardableResult
    public func requestAuthorization() async -> Bool {
        let status = await requestAuthorizationStatus()
        return status == .authorized || status == .limited
    }

    /// Requests authorization and returns the full `PHAuthorizationStatus` enum.
    @discardableResult
    public func requestAuthorizationStatus() async -> PHAuthorizationStatus {
        let status = await withCheckedContinuation { continuation in
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { newStatus in
                continuation.resume(returning: newStatus)
            }
        }
        self.authorizationStatus = status
        return status
    }

    // MARK: - Fetch Months

    /// Scans the Camera Roll and groups assets by calendar Year and Month.
    /// Runs aggregation off the MainActor in a detached background task to prevent UI hitching.
    /// Returns groups sorted in descending order (most recent month first).
    @discardableResult
    public func fetchMonths() async -> [YearMonthGroup] {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        let sortedGroups = await Task.detached(priority: .userInitiated) { () -> [YearMonthGroup] in
            let options = PHFetchOptions()
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
            options.predicate = NSPredicate(
                format: "mediaType == %d OR mediaType == %d",
                PHAssetMediaType.image.rawValue,
                PHAssetMediaType.video.rawValue
            )

            let fetchResult = PHAsset.fetchAssets(with: options)
            let calendar = Calendar.current
            var monthCounts: [String: (group: YearMonthGroup, count: Int)] = [:]

            for i in 0..<fetchResult.count {
                let asset = fetchResult.object(at: i)
                guard let date = asset.creationDate else { continue }
                let year = calendar.component(.year, from: date)
                let month = calendar.component(.month, from: date)
                let key = String(format: "%04d-%02d", year, month)
                if var existing = monthCounts[key] {
                    existing.count += 1
                    monthCounts[key] = existing
                } else {
                    monthCounts[key] = (YearMonthGroup(year: year, month: month, assetCount: 1), 1)
                }
            }

            return monthCounts.values
                .map { YearMonthGroup(year: $0.group.year, month: $0.group.month, assetCount: $0.count) }
                .sorted { lhs, rhs in
                    if lhs.year != rhs.year {
                        return lhs.year > rhs.year
                    }
                    return lhs.month > rhs.month
                }
        }.value

        self.months = sortedGroups
        return sortedGroups
    }

    // MARK: - Fetch Assets for Month

    /// Fetches all assets within the specified calendar month, sorted chronologically ascending.
    public func fetchAssets(for month: YearMonthGroup) -> [TriageAsset] {
        let calendar = Calendar.current
        var startComponents = DateComponents()
        startComponents.year = month.year
        startComponents.month = month.month
        startComponents.day = 1
        startComponents.hour = 0
        startComponents.minute = 0
        startComponents.second = 0

        guard let startDate = calendar.date(from: startComponents),
              let endDate = calendar.date(byAdding: .month, value: 1, to: startDate) else {
            return []
        }

        let options = PHFetchOptions()
        options.predicate = NSPredicate(
            format: "(mediaType == %d OR mediaType == %d) AND (creationDate >= %@ AND creationDate < %@)",
            PHAssetMediaType.image.rawValue,
            PHAssetMediaType.video.rawValue,
            startDate as NSDate,
            endDate as NSDate
        )
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]

        let fetchResult = PHAsset.fetchAssets(with: options)
        var results: [TriageAsset] = []
        results.reserveCapacity(fetchResult.count)

        for i in 0..<fetchResult.count {
            let phAsset = fetchResult.object(at: i)
            results.append(TriageAsset(asset: phAsset))
        }

        return results
    }

    // MARK: - Image Loading

    /// Loads a thumbnail image for grid or single view display with in-memory caching.
    public func loadThumbnail(
        for asset: TriageAsset,
        size: CGSize = CGSize(width: 320, height: 320)
    ) async -> UIImage? {
        let cacheKey = asset.id as NSString
        if let cached = thumbnailCache.object(forKey: cacheKey) {
            return cached
        }

        let targetWidth = max(size.width, 160)
        let targetHeight = max(size.height, 160)
        let safeSize = CGSize(width: targetWidth, height: targetHeight)

        let options = PHImageRequestOptions()
        options.deliveryMode = .opportunistic
        options.isNetworkAccessAllowed = true
        options.isSynchronous = false

        return await withCheckedContinuation { continuation in
            let box = StateBox()
            _ = imageManager.requestImage(
                for: asset.phAsset,
                targetSize: safeSize,
                contentMode: .aspectFill,
                options: options
            ) { [weak self] image, info in
                if let cancelled = info?[PHImageCancelledKey] as? Bool, cancelled {
                    if box.tryResume() {
                        continuation.resume(returning: nil)
                    }
                    return
                }
                if info?[PHImageErrorKey] != nil {
                    if box.tryResume() {
                        continuation.resume(returning: nil)
                    }
                    return
                }

                if let img = image {
                    self?.thumbnailCache.setObject(img, forKey: cacheKey)
                }

                if let isDegraded = info?[PHImageResultIsDegradedKey] as? Bool, isDegraded {
                    // For ultra-responsive rendering, deliver degraded preview immediately if non-nil
                    if let img = image, box.tryResume() {
                        continuation.resume(returning: img)
                    }
                    return
                }

                if box.tryResume() {
                    continuation.resume(returning: image)
                }
            }
        }
    }

    /// Loads the full-resolution image for single triage view inspection.
    /// Defers resuming until the final non-degraded full-res image is rendered.
    public func loadFullImage(for asset: TriageAsset) async -> UIImage? {
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        options.isSynchronous = false

        return await withCheckedContinuation { continuation in
            let box = StateBox()
            _ = PHImageManager.default().requestImage(
                for: asset.phAsset,
                targetSize: PHImageManagerMaximumSize,
                contentMode: .aspectFit,
                options: options
            ) { image, info in
                if let cancelled = info?[PHImageCancelledKey] as? Bool, cancelled {
                    if box.tryResume() {
                        continuation.resume(returning: nil)
                    }
                    return
                }
                if info?[PHImageErrorKey] != nil {
                    if box.tryResume() {
                        continuation.resume(returning: nil)
                    }
                    return
                }
                // If this is a degraded placeholder, wait for the final high-quality image
                if let isDegraded = info?[PHImageResultIsDegradedKey] as? Bool, isDegraded {
                    return
                }
                if box.tryResume() {
                    continuation.resume(returning: image)
                }
            }
        }
    }

    // MARK: - Resource Extraction

    /// Extracts all relevant asset resources using `PHAssetResourceManager`:
    /// - Primary image/video (required)
    /// - Live Photo companion video (optional)
    /// - Adjustment sidecar (.AAE) (optional)
    /// - Edited full-size render (optional)
    ///
    /// Video resources are streamed directly to temporary file URLs using `writeData(for:toFile:)`
    /// to avoid RAM exhaustion and OOM crashes on large 4K files.
    public func extractResources(for asset: TriageAsset) async throws -> [ExtractedResource] {
        let phAsset = asset.phAsset
        let allResources = PHAssetResource.assetResources(for: phAsset)

        guard !allResources.isEmpty else {
            throw PhotoKitError.missingPrimaryResource(asset.id)
        }

        var assigned: [(resource: PHAssetResource, role: ResourceRole)] = []

        // 1. Identify Primary resource
        if asset.isVideo {
            if let primaryVideo = allResources.first(where: { $0.type == .video }) ??
                                  allResources.first(where: { $0.type == .fullSizeVideo }) {
                assigned.append((primaryVideo, .primary))
            }
        } else {
            if let primaryPhoto = allResources.first(where: { $0.type == .photo }) ??
                                  allResources.first(where: { $0.type == .fullSizePhoto }) {
                assigned.append((primaryPhoto, .primary))
            }
        }

        // 2. Identify Live Photo companion video (.MOV)
        if asset.isLivePhoto {
            if let liveMov = allResources.first(where: { $0.type == .pairedVideo }) ??
                             allResources.first(where: { $0.type == .fullSizePairedVideo }) {
                assigned.append((liveMov, .liveVideo))
            }
        }

        // 3. Identify Adjustment sidecar (.AAE)
        if let adjustment = allResources.first(where: { $0.type == .adjustmentData }) {
            assigned.append((adjustment, .editSidecar))
        }

        // 4. Identify Edited render if present and distinct from primary
        if asset.isVideo {
            if let render = allResources.first(where: { $0.type == .fullSizeVideo }),
               !assigned.contains(where: { $0.resource === render }) {
                assigned.append((render, .editedRender))
            }
        } else {
            if let render = allResources.first(where: { $0.type == .fullSizePhoto }),
               !assigned.contains(where: { $0.resource === render }) {
                assigned.append((render, .editedRender))
            }
        }

        // Ensure primary was successfully assigned
        if !assigned.contains(where: { $0.role == .primary }) {
            if let fallback = allResources.first {
                assigned.append((fallback, .primary))
            } else {
                throw PhotoKitError.missingPrimaryResource(asset.id)
            }
        }

        var extractedResources: [ExtractedResource] = []
        let resourceManager = PHAssetResourceManager.default()

        for item in assigned {
            let res = item.resource
            let role = item.role
            let filename: String

            if !res.originalFilename.isEmpty {
                if role == .editSidecar && (res.originalFilename.lowercased().hasSuffix(".plist") || res.originalFilename.lowercased() == "adjustments.plist") {
                    filename = "\(asset.canonicalName).AAE"
                } else {
                    filename = res.originalFilename
                }
            } else {
                let ext: String
                switch role {
                case .primary:
                    ext = asset.isVideo ? "mov" : "heic"
                case .liveVideo:
                    ext = "mov"
                case .editSidecar:
                    ext = "aae"
                case .editedRender:
                    ext = asset.isVideo ? "mov" : "jpg"
                }
                filename = "\(asset.canonicalName).\(ext.uppercased())"
            }

            let mime = resolveMimeType(for: res, filename: filename)
            let requestOptions = PHAssetResourceRequestOptions()
            requestOptions.isNetworkAccessAllowed = true

            // For video assets (Live Photo paired video, standalone video, edited video),
            // stream directly to a temporary file to prevent memory exhaustion / OOM crashes.
            let isVideoResource = (role == .liveVideo) ||
                                  (role == .primary && asset.isVideo) ||
                                  (role == .editedRender && asset.isVideo)

            if isVideoResource {
                let tempDir = FileManager.default.temporaryDirectory
                let tempFileURL = tempDir.appendingPathComponent("\(UUID().uuidString)_\(filename)")
                try? FileManager.default.removeItem(at: tempFileURL)

                do {
                    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                        let box = StateBox()
                        resourceManager.writeData(
                            for: res,
                            toFile: tempFileURL,
                            options: requestOptions
                        ) { error in
                            guard box.tryResume() else { return }
                            if let error = error {
                                continuation.resume(throwing: error)
                            } else {
                                continuation.resume()
                            }
                        }
                    }
                } catch {
                    throw PhotoKitError.resourceExtractionFailed("Resource '\(filename)' write to disk failed: \(error.localizedDescription)")
                }

                extractedResources.append(
                    ExtractedResource(
                        role: role,
                        filename: filename,
                        data: nil,
                        fileURL: tempFileURL,
                        mimeType: mime
                    )
                )
            } else {
                // For photos and XML sidecars, buffer in memory
                let bufferBox = BufferBox()
                do {
                    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                        let box = StateBox()
                        _ = resourceManager.requestData(
                            for: res,
                            options: requestOptions,
                            dataReceivedHandler: { chunk in
                                bufferBox.append(chunk)
                            },
                            completionHandler: { error in
                                guard box.tryResume() else { return }
                                if let error = error {
                                    continuation.resume(throwing: error)
                                } else {
                                    continuation.resume()
                                }
                            }
                        )
                    }
                } catch {
                    throw PhotoKitError.resourceExtractionFailed("Resource '\(filename)' extraction failed: \(error.localizedDescription)")
                }

                extractedResources.append(
                    ExtractedResource(
                        role: role,
                        filename: filename,
                        data: bufferBox.getData(),
                        fileURL: nil,
                        mimeType: mime
                    )
                )
            }
        }

        return extractedResources
    }

    private func resolveMimeType(for resource: PHAssetResource, filename: String) -> String {
        #if canImport(UniformTypeIdentifiers)
        if #available(iOS 14.0, macOS 11.0, *) {
            if let utType = UTType(resource.uniformTypeIdentifier),
               let mime = utType.preferredMIMEType {
                return mime
            }
        }
        #endif

        let ext = (filename as NSString).pathExtension.lowercased()
        switch ext {
        case "heic", "heif":
            return "image/heic"
        case "jpg", "jpeg":
            return "image/jpeg"
        case "png":
            return "image/png"
        case "gif":
            return "image/gif"
        case "mov":
            return "video/quicktime"
        case "mp4":
            return "video/mp4"
        case "aae":
            return "application/xml"
        default:
            return "application/octet-stream"
        }
    }

    // MARK: - Asset Deletion with Safety Guards

    /// Deletes the specified raw `PHAsset` objects via Apple's native deletion confirmation.
    public func deleteAssets(assets: [PHAsset]) async throws -> Bool {
        guard !assets.isEmpty else { return true }

        return try await withCheckedThrowingContinuation { continuation in
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.deleteAssets(assets as NSArray)
            }) { success, error in
                if let error = error {
                    continuation.resume(throwing: PhotoKitError.deleteFailed(error.localizedDescription))
                } else {
                    continuation.resume(returning: success)
                }
            }
        }
    }

    /// Safely deletes triaged assets according to their decisions.
    ///
    /// SAFETY INVARIANT:
    /// - ONLY assets with decision `.trash` and `.backupOnly` are sent for deletion.
    /// - Assets with decision `.backupKeep` are STRICTLY PRESERVED and never deleted.
    /// - Assets with decision `.unsorted` are STRICTLY PRESERVED.
    public func deleteTriagedAssets(
        assets: [TriageAsset],
        decisions: [String: TriageDecision]
    ) async throws -> (deletedCount: Int, keptCount: Int) {
        var assetsToDelete: [PHAsset] = []
        var keptCount = 0

        for asset in assets {
            let decision = decisions[asset.id] ?? .unsorted
            switch decision {
            case .trash, .backupOnly:
                assetsToDelete.append(asset.phAsset)
            case .backupKeep:
                keptCount += 1
            case .unsorted:
                break
            }
        }

        if assetsToDelete.isEmpty {
            return (deletedCount: 0, keptCount: keptCount)
        }

        let success = try await deleteAssets(assets: assetsToDelete)
        return (deletedCount: success ? assetsToDelete.count : 0, keptCount: keptCount)
    }
}

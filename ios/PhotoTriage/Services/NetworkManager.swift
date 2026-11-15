import Foundation
import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// MARK: - Network Error

public enum NetworkError: LocalizedError, Equatable, Sendable {
    case invalidUrl(String)
    case serverUnreachable(String)
    case invalidDecision(String)
    case missingPrimaryResource(String)
    case uploadFailed(String)
    case verificationFailed(String)
    case serverError(statusCode: Int, message: String)

    public var errorDescription: String? {
        switch self {
        case .invalidUrl(let url):
            return "Invalid server URL: '\(url)'"
        case .serverUnreachable(let details):
            return "Server unreachable: \(details)"
        case .invalidDecision(let decision):
            return "Cannot upload asset with triage decision '\(decision)'. Only 'backup_only' and 'backup_keep' are permitted."
        case .missingPrimaryResource(let id):
            return "Asset '\(id)' has no primary photo or video resource."
        case .uploadFailed(let reason):
            return "Upload failed: \(reason)"
        case .verificationFailed(let reason):
            return "Server verification failed: \(reason)"
        case .serverError(let statusCode, let message):
            return "Server error (HTTP \(statusCode)): \(message)"
        }
    }
}

// MARK: - Server Response DTOs

public struct LedgerEntryDto: Codable, Sendable, Equatable {
    public let id: String
    public let canonicalName: String
    public let sha256: String
    public let targetRelPath: String
    public let capturedAt: String?
    public let backedUpAt: String?
    public let decision: String

    public init(
        id: String,
        canonicalName: String,
        sha256: String,
        targetRelPath: String,
        capturedAt: String? = nil,
        backedUpAt: String? = nil,
        decision: String
    ) {
        self.id = id
        self.canonicalName = canonicalName
        self.sha256 = sha256
        self.targetRelPath = targetRelPath
        self.capturedAt = capturedAt
        self.backedUpAt = backedUpAt
        self.decision = decision
    }
}

public struct UploadResult: Codable, Sendable, Equatable {
    public let success: Bool
    public let verifiedCount: Int
    public let entries: [LedgerEntryDto]
    public let primarySha256: String?
    public let targetRelPath: String?

    public init(
        success: Bool = true,
        verifiedCount: Int,
        entries: [LedgerEntryDto] = []
    ) {
        self.success = success
        self.verifiedCount = verifiedCount
        self.entries = entries
        self.primarySha256 = entries.first?.sha256
        self.targetRelPath = entries.first?.targetRelPath
    }
}

public struct ServerSessionStatus: Codable, Sendable {
    public let sessionId: String?
    public let stagingDir: String?
    public let hardDriveRoot: String?
    public let hardDriveMounted: Bool?
    public let status: String?
    public let isBackupVerified: Bool?
}

private struct RawServerResponse: Codable {
    let success: Bool?
    let verifiedCount: Int?
    let entries: [LedgerEntryDto]?
    let error: String?
    let errors: [String]?
}

// MARK: - Network Manager

/// MainActor observable networking service managing connectivity and multipart asset bundle uploads
/// to the Mac server. Supports both in-memory buffering and memory-safe streaming from disk.
@MainActor
public final class NetworkManager: ObservableObject, Sendable {
    public static let shared = NetworkManager()

    public static let defaultServerUrl = "http://10.142.1.127:3000"
    public static let userDefaultsKey = "photoTriageServerUrl"

    @Published public var serverUrl: String {
        didSet {
            let sanitized = Self.sanitizeUrl(serverUrl)
            if serverUrl != sanitized {
                serverUrl = sanitized
            }
            UserDefaults.standard.set(sanitized, forKey: Self.userDefaultsKey)
        }
    }

    @Published public var isReachable: Bool = false
    @Published public var isUploading: Bool = false
    @Published public var lastError: String? = nil

    private let session: URLSession

    public init(serverUrl: String? = nil, session: URLSession = .shared) {
        self.session = session

        let initial: String
        if let explicitUrl = serverUrl, !explicitUrl.isEmpty {
            initial = explicitUrl
        } else if let saved = UserDefaults.standard.string(forKey: Self.userDefaultsKey), !saved.isEmpty {
            initial = saved
        } else {
            initial = Self.defaultServerUrl
        }

        self.serverUrl = Self.sanitizeUrl(initial)
    }

    // MARK: - URL Sanitization

    /// Normalizes server URL string by stripping whitespace, trailing slashes,
    /// and ensuring http:// or https:// prefix.
    public static func sanitizeUrl(_ input: String) -> String {
        var trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while trimmed.hasSuffix("/") {
            trimmed.removeLast()
        }
        if !trimmed.isEmpty && !trimmed.lowercased().hasPrefix("http://") && !trimmed.lowercased().hasPrefix("https://") {
            trimmed = "http://" + trimmed
        }
        return trimmed
    }

    public var cleanServerUrl: String {
        Self.sanitizeUrl(serverUrl)
    }

    public func setServerUrl(_ newUrl: String) {
        let sanitized = Self.sanitizeUrl(newUrl)
        self.serverUrl = sanitized
    }

    // MARK: - Server Ping & Session Status

    /// Pings the Mac server via `GET /api/session` with a fast timeout.
    /// Updates `isReachable` and returns boolean reachability.
    @discardableResult
    public func pingServer() async -> Bool {
        guard let url = URL(string: "\(cleanServerUrl)/api/session") else {
            self.isReachable = false
            return false
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 3.5

        do {
            let (_, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                self.isReachable = false
                return false
            }
            let reachable = (200..<300).contains(httpResponse.statusCode)
            self.isReachable = reachable
            return reachable
        } catch {
            self.isReachable = false
            return false
        }
    }

    /// Fetches full server session status including hard drive mounted state.
    public func fetchSessionStatus() async throws -> ServerSessionStatus {
        guard let url = URL(string: "\(cleanServerUrl)/api/session") else {
            throw NetworkError.invalidUrl(cleanServerUrl)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 5.0

        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? 500
                throw NetworkError.serverError(statusCode: code, message: "Failed to fetch session status")
            }
            return try JSONDecoder().decode(ServerSessionStatus.self, from: data)
        } catch let err as NetworkError {
            throw err
        } catch {
            throw NetworkError.serverUnreachable(error.localizedDescription)
        }
    }

    // MARK: - Multipart Upload Engine

    /// Uploads an asset bundle along with its extracted companion resources to the Mac server.
    /// Streams large video files directly from temporary disk files to avoid memory pressure and OOM crashes.
    public func uploadBundle(
        asset: TriageAsset,
        resources: [ExtractedResource],
        decision: TriageDecision
    ) async throws -> UploadResult {
        // Invariant 1: Only backup_only and backup_keep require and allow server upload
        guard decision.requiresBackupUpload else {
            throw NetworkError.invalidDecision(decision.rawValue)
        }

        // Invariant 2: Must have at least one primary resource
        guard resources.contains(where: { $0.role == .primary }) else {
            throw NetworkError.missingPrimaryResource(asset.id)
        }

        guard let uploadUrl = URL(string: "\(cleanServerUrl)/api/upload") else {
            throw NetworkError.invalidUrl("\(cleanServerUrl)/api/upload")
        }

        isUploading = true
        lastError = nil
        defer { isUploading = false }

        // Sanitize asset identifier for bundleId (safe against path traversal)
        let sanitizedId = asset.id
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: "_")
        let bundleId = sanitizedId.isEmpty ? asset.canonicalName : sanitizedId

        let fields: [(name: String, value: String)] = [
            ("bundleId", bundleId),
            ("canonicalName", asset.canonicalName),
            ("capturedAt", asset.capturedAtISO),
            ("targetYear", asset.targetYear),
            ("targetMonth", asset.targetMonth),
            ("decision", decision.rawValue)
        ]

        let boundary = "Boundary-\(UUID().uuidString)"
        let tempBodyURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("UploadBody_\(UUID().uuidString).tmp")

        defer {
            try? FileManager.default.removeItem(at: tempBodyURL)
        }

        // Construct streaming multipart body on disk to prevent RAM exhaustion
        FileManager.default.createFile(atPath: tempBodyURL.path, contents: nil)
        guard let fileHandle = try? FileHandle(forWritingTo: tempBodyURL) else {
            let err = NetworkError.uploadFailed("Failed to create temporary body file for streaming upload")
            self.lastError = err.localizedDescription
            throw err
        }

        do {
            // Write form text fields
            for (name, val) in fields {
                try writeStringToHandle(fileHandle, "--\(boundary)\r\n")
                try writeStringToHandle(fileHandle, "Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
                try writeStringToHandle(fileHandle, "\(val)\r\n")
            }

            // Write file parts
            for res in resources {
                try writeStringToHandle(fileHandle, "--\(boundary)\r\n")
                try writeStringToHandle(
                    fileHandle,
                    "Content-Disposition: form-data; name=\"\(res.role.rawValue)\"; filename=\"\(res.filename)\"\r\n"
                )
                try writeStringToHandle(fileHandle, "Content-Type: \(res.mimeType)\r\n\r\n")

                if let fileURL = res.fileURL {
                    // Stream from disk in chunks (1MB buffer) for large video files
                    let readHandle = try FileHandle(forReadingFrom: fileURL)
                    defer { try? readHandle.close() }
                    while true {
                        let chunk = readHandle.readData(ofLength: 1024 * 1024)
                        if chunk.isEmpty { break }
                        try fileHandle.write(contentsOf: chunk)
                    }
                } else if let data = res.data {
                    try fileHandle.write(contentsOf: data)
                }
                try writeStringToHandle(fileHandle, "\r\n")
            }

            // Write final closing boundary
            try writeStringToHandle(fileHandle, "--\(boundary)--\r\n")
            try fileHandle.close()
        } catch {
            try? fileHandle.close()
            let netErr = NetworkError.uploadFailed("Failed to assemble multipart body: \(error.localizedDescription)")
            self.lastError = netErr.localizedDescription
            throw netErr
        }

        // Prepare URLRequest
        var request = URLRequest(url: uploadUrl)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 180.0

        // Perform Upload
        let responseData: Data
        let response: URLResponse

        do {
            (responseData, response) = try await session.upload(for: request, fromFile: tempBodyURL)
        } catch let urlErr as URLError {
            let netErr = NetworkError.serverUnreachable(urlErr.localizedDescription)
            self.lastError = netErr.localizedDescription
            throw netErr
        } catch {
            let netErr = NetworkError.uploadFailed(error.localizedDescription)
            self.lastError = netErr.localizedDescription
            throw netErr
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            let netErr = NetworkError.uploadFailed("Invalid server response (non-HTTP protocol)")
            self.lastError = netErr.localizedDescription
            throw netErr
        }

        // Parse Response
        if httpResponse.statusCode == 200 {
            let serverResp: RawServerResponse
            do {
                serverResp = try JSONDecoder().decode(RawServerResponse.self, from: responseData)
            } catch {
                let netErr = NetworkError.verificationFailed("Failed to parse server upload response: \(error.localizedDescription)")
                self.lastError = netErr.localizedDescription
                throw netErr
            }

            guard serverResp.success == true else {
                let msg = serverResp.error ?? serverResp.errors?.joined(separator: ", ") ?? "Server reported failure"
                let netErr = NetworkError.verificationFailed(msg)
                self.lastError = netErr.localizedDescription
                throw netErr
            }

            let entries = serverResp.entries ?? []
            let verifiedCount = serverResp.verifiedCount ?? entries.count

            guard verifiedCount > 0 else {
                let netErr = NetworkError.verificationFailed("Server reported 0 verified files")
                self.lastError = netErr.localizedDescription
                throw netErr
            }

            return UploadResult(
                success: true,
                verifiedCount: verifiedCount,
                entries: entries
            )
        } else {
            var errorMsg: String? = nil
            if let decodedError = try? JSONDecoder().decode(RawServerResponse.self, from: responseData) {
                errorMsg = decodedError.error ?? decodedError.errors?.joined(separator: ", ")
            }
            if errorMsg == nil {
                errorMsg = String(data: responseData, encoding: .utf8)
            }
            let message = errorMsg ?? "HTTP error \(httpResponse.statusCode)"

            let netErr: NetworkError
            if httpResponse.statusCode == 400 {
                netErr = NetworkError.uploadFailed(message)
            } else {
                netErr = NetworkError.serverError(statusCode: httpResponse.statusCode, message: message)
            }
            self.lastError = netErr.localizedDescription
            throw netErr
        }
    }

    /// Convenience upload method that automatically extracts resources via `PhotoKitManager.shared`
    /// and cleans up temporary files after upload completes.
    public func uploadBundle(
        asset: TriageAsset,
        decision: TriageDecision
    ) async throws -> UploadResult {
        let resources = try await PhotoKitManager.shared.extractResources(for: asset)
        defer {
            for res in resources {
                res.cleanup()
            }
        }
        return try await uploadBundle(asset: asset, resources: resources, decision: decision)
    }

    // MARK: - In-Memory Multipart Builder (Utility & Testing)

    /// Builds in-memory multipart payload Data matching RFC 2046 specification.
    /// Useful for mock tests and contract verification.
    public static func buildMultipartPayload(
        boundary: String,
        fields: [String: String],
        resources: [ExtractedResource]
    ) throws -> Data {
        var body = Data()

        for (name, val) in fields {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(val)\r\n".data(using: .utf8)!)
        }

        for res in resources {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append(
                "Content-Disposition: form-data; name=\"\(res.role.rawValue)\"; filename=\"\(res.filename)\"\r\n"
                    .data(using: .utf8)!
            )
            body.append("Content-Type: \(res.mimeType)\r\n\r\n".data(using: .utf8)!)
            let data = try res.loadData()
            body.append(data)
            body.append("\r\n".data(using: .utf8)!)
        }

        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        return body
    }

    // MARK: - Private Helpers

    private func writeStringToHandle(_ handle: FileHandle, _ string: String) throws {
        if let data = string.data(using: .utf8) {
            try handle.write(contentsOf: data)
        }
    }
}

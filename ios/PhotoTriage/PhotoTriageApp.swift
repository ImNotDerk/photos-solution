import SwiftUI

/// Main entry point for the PhotoTriage native iOS application.
/// Initializes singletons and environment objects for state, network, and PhotoKit management.
@main
public struct PhotoTriageApp: App {
    @StateObject private var triageState = TriageState.shared
    @StateObject private var networkManager = NetworkManager.shared
    @StateObject private var photoKitManager = PhotoKitManager.shared

    public init() {}

    public var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(triageState)
                .environmentObject(networkManager)
                .environmentObject(photoKitManager)
                #if canImport(UIKit)
                .preferredColorScheme(.dark)
                #endif
        }
    }
}

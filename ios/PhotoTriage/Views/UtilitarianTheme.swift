import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// MARK: - Utilitarian Palette

public extension Color {
    // Slate scale (Tailwind CSS precision values)
    static let slate950 = Color(red: 2/255, green: 6/255, blue: 23/255)
    static let slate900 = Color(red: 15/255, green: 23/255, blue: 42/255) // Primary surface
    static let slate800 = Color(red: 30/255, green: 41/255, blue: 59/255) // Card surface / elevated
    static let slate700 = Color(red: 51/255, green: 65/255, blue: 85/255) // Borders
    static let slate600 = Color(red: 71/255, green: 85/255, blue: 105/255) // Secondary borders
    static let slate500 = Color(red: 100/255, green: 116/255, blue: 139/255) // Muted labels
    static let slate400 = Color(red: 148/255, green: 163/255, blue: 184/255) // Secondary text
    static let slate300 = Color(red: 203/255, green: 213/255, blue: 225/255) // Primary text
    static let slate200 = Color(red: 226/255, green: 232/255, blue: 240/255) // High-contrast text
    static let slate100 = Color(red: 241/255, green: 245/255, blue: 249/255) // Maximum brightness

    // Utilitarian Functional Accents
    static let triageTrash = Color(red: 239/255, green: 68/255, blue: 68/255)       // Crimson Red (#EF4444)
    static let triageBackupOnly = Color(red: 245/255, green: 158/255, blue: 11/255)  // Amber Orange (#F59E0B)
    static let triageBackupKeep = Color(red: 34/255, green: 197/255, blue: 94/255)   // Mint Green (#22C55E)
    static let triageUnsorted = Color(red: 100/255, green: 116/255, blue: 139/255)   // Neutral Slate (#64748B)
    static let consoleCyan = Color(red: 6/255, green: 182/255, blue: 212/255)       // Monospaced accent (#06B6D4)
}

// MARK: - Cross-Platform Image Helper

public extension Image {
    init(platformImage: UIImage) {
        #if canImport(UIKit)
        self.init(uiImage: platformImage)
        #elseif canImport(AppKit)
        self.init(nsImage: platformImage)
        #endif
    }
}

// MARK: - Utilitarian View Modifiers & Styles

public struct UtilitarianCardModifier: ViewModifier {
    public var backgroundColor: Color = .slate900
    public var borderColor: Color = .slate700
    public var cornerRadius: CGFloat = 4

    public func body(content: Content) -> some View {
        content
            .background(backgroundColor)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .stroke(borderColor, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }
}

public struct UtilitarianBorderModifier: ViewModifier {
    public var color: Color = .slate700
    public var width: CGFloat = 1
    public var cornerRadius: CGFloat = 4

    public func body(content: Content) -> some View {
        content
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .stroke(color, lineWidth: width)
            )
    }
}

public extension View {
    func utilitarianCard(
        backgroundColor: Color = .slate900,
        borderColor: Color = .slate700,
        cornerRadius: CGFloat = 4
    ) -> some View {
        modifier(UtilitarianCardModifier(
            backgroundColor: backgroundColor,
            borderColor: borderColor,
            cornerRadius: cornerRadius
        ))
    }

    func utilitarianBorder(
        color: Color = .slate700,
        width: CGFloat = 1,
        cornerRadius: CGFloat = 4
    ) -> some View {
        modifier(UtilitarianBorderModifier(
            color: color,
            width: width,
            cornerRadius: cornerRadius
        ))
    }
}

// MARK: - Mobile-Friendly Apple Ergonomic Helpers

public func triggerHapticFeedback(_ style: Int = 1) {
    #if canImport(UIKit)
    let generator = UIImpactFeedbackGenerator(style: style == 0 ? .light : (style == 1 ? .medium : .heavy))
    generator.prepare()
    generator.impactOccurred()
    #endif
}

public struct AppleActionButtonModifier: ViewModifier {
    public var backgroundColor: Color
    public var foregroundColor: Color
    public var cornerRadius: CGFloat = 12

    public func body(content: Content) -> some View {
        content
            .foregroundColor(foregroundColor)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 50)
            .background(backgroundColor)
            .cornerRadius(cornerRadius)
    }
}

public extension View {
    func appleActionButton(
        backgroundColor: Color,
        foregroundColor: Color = .white,
        cornerRadius: CGFloat = 12
    ) -> some View {
        modifier(AppleActionButtonModifier(
            backgroundColor: backgroundColor,
            foregroundColor: foregroundColor,
            cornerRadius: cornerRadius
        ))
    }
}


public struct TactileButtonStyle: ButtonStyle {
    public var foregroundColor: Color = .slate100
    public var backgroundColor: Color = .slate800
    public var borderColor: Color = .slate700
    public var borderWidth: CGFloat = 1
    public var cornerRadius: CGFloat = 4

    public init(
        foregroundColor: Color = .slate100,
        backgroundColor: Color = .slate800,
        borderColor: Color = .slate700,
        borderWidth: CGFloat = 1,
        cornerRadius: CGFloat = 4
    ) {
        self.foregroundColor = foregroundColor
        self.backgroundColor = backgroundColor
        self.borderColor = borderColor
        self.borderWidth = borderWidth
        self.cornerRadius = cornerRadius
    }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.subheadline, design: .monospaced).weight(.bold))
            .foregroundColor(foregroundColor)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(configuration.isPressed ? backgroundColor.opacity(0.7) : backgroundColor)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .stroke(borderColor, lineWidth: borderWidth)
            )
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }
}

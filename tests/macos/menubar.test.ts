import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('macOS Menu Bar Companion App & Desktop Launcher Tests', () => {
  const rootDir = process.cwd();
  const launcherPath = path.resolve(rootDir, 'Start Photo Triage.command');
  const menubarSwiftPath = path.resolve(rootDir, 'macos/PhotoTriageMenuBar/main.swift');
  const menubarPlistPath = path.resolve(rootDir, 'macos/PhotoTriageMenuBar/Info.plist');
  const buildScriptPath = path.resolve(rootDir, 'macos/build-menubar-app.sh');
  const appBundlePath = path.resolve(rootDir, 'dist/macos/PhotoTriageMenuBar.app');

  describe('1-Click Desktop Launcher Script', () => {
    it('verifies Start Photo Triage.command exists and has executable permissions', () => {
      expect(fs.existsSync(launcherPath)).toBe(true);
      const stat = fs.statSync(launcherPath);
      // Check executable bit for user (0o100)
      expect(stat.mode & 0o111).toBeGreaterThan(0);
    });

    it('contains portable repository root resolution and browser launch logic', () => {
      const content = fs.readFileSync(launcherPath, 'utf8');
      expect(content).toContain('Photo Triage - Mac Backup Server');
      expect(content).toContain('http://localhost:3000');
      expect(content).toContain('open "http://localhost:3000"');
      expect(content).toContain('npm start');
    });
  });

  describe('macOS Menu Bar App Configuration & Plist', () => {
    it('verifies main.swift and Info.plist exist', () => {
      expect(fs.existsSync(menubarSwiftPath)).toBe(true);
      expect(fs.existsSync(menubarPlistPath)).toBe(true);
      expect(fs.existsSync(buildScriptPath)).toBe(true);
    });

    it('validates Info.plist syntax using plutil', () => {
      expect(() => {
        execSync(`plutil -lint "${menubarPlistPath}"`, { stdio: 'pipe' });
      }).not.toThrow();
    });

    it('verifies LSUIElement is true so it hides from Dock as a menu bar item', () => {
      const rawJson = execSync(`plutil -convert json -o - "${menubarPlistPath}"`, { encoding: 'utf8' });
      const plist = JSON.parse(rawJson);
      expect(plist.LSUIElement).toBe(true);
      expect(plist.CFBundleIdentifier).toBe('com.phototriage.menubar');
    });

    it('verifies main.swift contains Finder folder picker and preset options', () => {
      const swiftContent = fs.readFileSync(menubarSwiftPath, 'utf8');
      expect(swiftContent).toContain('NSOpenPanel');
      expect(swiftContent).toContain('Choose Backup Folder in Finder...');
      expect(swiftContent).toContain('Folder Hierarchy Preset');
      expect(swiftContent).toContain('{YYYY}/{MONTH}');
      expect(swiftContent).toContain('{YYYY}/{MM}');
      expect(swiftContent).toContain('{YYYY}-{MM}');
      expect(swiftContent).toContain('http://localhost:3000');
      expect(swiftContent).toContain('172.20.10.2:3000');
    });
  });

  describe('Menu Bar App Compilation & Bundling', () => {
    it('successfully compiles into signed macOS .app bundle', () => {
      const binaryPath = path.join(appBundlePath, 'Contents/MacOS/PhotoTriageMenuBar');
      expect(fs.existsSync(binaryPath)).toBe(true);

      const codesignOut = execSync(`codesign --verify --verbose "${appBundlePath}" 2>&1`, { encoding: 'utf8' });
      expect(codesignOut).toContain('valid on disk');
    });
  });
});

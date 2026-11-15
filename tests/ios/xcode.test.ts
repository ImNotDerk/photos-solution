import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('Xcode Project & Info.plist Configuration Tests (Task 5)', () => {
  const rootDir = process.cwd();
  const infoPlistPath = path.resolve(rootDir, 'ios/PhotoTriage/Info.plist');
  const projectFilePath = path.resolve(rootDir, 'ios/PhotoTriage.xcodeproj/project.pbxproj');
  const workspacePath = path.resolve(rootDir, 'ios/PhotoTriage.xcodeproj/project.xcworkspace/contents.xcworkspacedata');
  const swiftSourceDir = path.resolve(rootDir, 'ios/PhotoTriage');

  describe('File Existence & Linter Validation', () => {
    it('verifies required project files exist on disk', () => {
      expect(fs.existsSync(infoPlistPath)).toBe(true);
      expect(fs.existsSync(projectFilePath)).toBe(true);
      expect(fs.existsSync(workspacePath)).toBe(true);
    });

    it('passes plutil -lint for Info.plist', () => {
      expect(() => {
        execSync(`plutil -lint "${infoPlistPath}"`, { stdio: 'pipe' });
      }).not.toThrow();
    });

    it('passes plutil -lint for project.pbxproj', () => {
      expect(() => {
        execSync(`plutil -lint "${projectFilePath}"`, { stdio: 'pipe' });
      }).not.toThrow();
    });
  });

  describe('Info.plist Permissions & Configuration Contract', () => {
    // Read and parse Info.plist using macOS native plutil to JSON
    const rawJson = execSync(`plutil -convert json -o - "${infoPlistPath}"`, { encoding: 'utf8' });
    const plist = JSON.parse(rawJson);

    it('contains NSPhotoLibraryUsageDescription explaining triage & backup', () => {
      expect(plist.NSPhotoLibraryUsageDescription).toBe(
        'Photo Triage needs access to your photo library to browse and triage photos for external hard drive backup.'
      );
    });

    it('contains NSLocalNetworkUsageDescription explaining local Wi-Fi Mac connection', () => {
      expect(plist.NSLocalNetworkUsageDescription).toBe(
        'Photo Triage connects to your Mac on the local Wi-Fi network to back up selected photos to your external hard drive.'
      );
    });

    it('configures NSAppTransportSecurity with local networking allowance', () => {
      expect(plist.NSAppTransportSecurity).toBeDefined();
      expect(typeof plist.NSAppTransportSecurity).toBe('object');
      expect(plist.NSAppTransportSecurity.NSAllowsLocalNetworking).toBe(true);
      expect(plist.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(false);
    });

    it('specifies CFBundleShortVersionString and CFBundleVersion', () => {
      expect(plist.CFBundleShortVersionString).toBe('1.0.0');
      expect(plist.CFBundleVersion).toBe('1');
    });

    it('enforces UIUserInterfaceStyle = Dark for utilitarian aesthetic', () => {
      expect(plist.UIUserInterfaceStyle).toBe('Dark');
    });

    it('defines UILaunchScreen', () => {
      expect(plist.UILaunchScreen).toBeDefined();
      expect(typeof plist.UILaunchScreen).toBe('object');
    });
  });

  describe('project.pbxproj Structure & Build Configuration Contract', () => {
    const rawJson = execSync(`plutil -convert json -o - "${projectFilePath}"`, { encoding: 'utf8' });
    const pbx = JSON.parse(rawJson);
    const objects = pbx.objects;

    it('has valid archiveVersion and objectVersion', () => {
      expect(pbx.archiveVersion).toBe('1');
      expect(['54', '55', '56']).toContain(pbx.objectVersion);
    });

    it('has a valid root PBXProject object', () => {
      const rootId = pbx.rootObject;
      expect(rootId).toBeDefined();
      const rootObj = objects[rootId];
      expect(rootObj).toBeDefined();
      expect(rootObj.isa).toBe('PBXProject');
      expect(rootObj.targets).toBeDefined();
      expect(rootObj.targets.length).toBeGreaterThanOrEqual(1);
    });

    it('defines PBXNativeTarget for PhotoTriage iOS Application', () => {
      const rootObj = objects[pbx.rootObject];
      const targetId = rootObj.targets[0];
      const target = objects[targetId];

      expect(target.isa).toBe('PBXNativeTarget');
      expect(target.name).toBe('PhotoTriage');
      expect(target.productType).toBe('com.apple.product-type.application');
      expect(target.productReference).toBeDefined();

      const productRef = objects[target.productReference];
      expect(productRef.path).toBe('PhotoTriage.app');
    });

    it('configures build settings: deployment target 16.0, bundle ID, automatic signing, Swift 5/6', () => {
      const rootObj = objects[pbx.rootObject];
      const targetId = rootObj.targets[0];
      const target = objects[targetId];
      const configList = objects[target.buildConfigurationList];
      expect(configList).toBeDefined();
      expect(configList.buildConfigurations.length).toBeGreaterThanOrEqual(1);

      for (const configId of configList.buildConfigurations) {
        const config = objects[configId];
        expect(config.isa).toBe('XCBuildConfiguration');
        const settings = config.buildSettings;

        expect(settings.IPHONEOS_DEPLOYMENT_TARGET).toBe('16.0');
        expect(settings.PRODUCT_BUNDLE_IDENTIFIER).toBe('com.photosolution.PhotoTriage');
        expect(settings.CODE_SIGN_STYLE).toBe('Automatic');
        expect(['5.0', '6.0']).toContain(settings.SWIFT_VERSION);
        expect(settings.INFOPLIST_FILE).toBe('PhotoTriage/Info.plist');
      }
    });

    it('includes Photos, SwiftUI, and UIKit framework references in PBXFrameworksBuildPhase', () => {
      const rootObj = objects[pbx.rootObject];
      const target = objects[rootObj.targets[0]];

      // Find PBXFrameworksBuildPhase
      const frameworksPhaseId = target.buildPhases.find((id: string) => objects[id].isa === 'PBXFrameworksBuildPhase');
      expect(frameworksPhaseId).toBeDefined();
      const frameworksPhase = objects[frameworksPhaseId];

      const linkedFrameworkNames = frameworksPhase.files.map((fileId: string) => {
        const buildFile = objects[fileId];
        const fileRef = objects[buildFile.fileRef];
        return fileRef.name || path.basename(fileRef.path);
      });

      expect(linkedFrameworkNames).toContain('Photos.framework');
      expect(linkedFrameworkNames).toContain('SwiftUI.framework');
      expect(linkedFrameworkNames).toContain('UIKit.framework');
    });

    it('includes every Swift source file in PBXFileReference and PBXSourcesBuildPhase', () => {
      // Find all swift files in ios/PhotoTriage recursively
      function findSwiftFiles(dir: string): string[] {
        let results: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            results = results.concat(findSwiftFiles(fullPath));
          } else if (entry.isFile() && entry.name.endsWith('.swift')) {
            results.push(entry.name);
          }
        }
        return results;
      }

      const allSwiftFilenames = findSwiftFiles(swiftSourceDir);
      expect(allSwiftFilenames.length).toBeGreaterThanOrEqual(12);

      // Inspect PBXSourcesBuildPhase
      const rootObj = objects[pbx.rootObject];
      const target = objects[rootObj.targets[0]];
      const sourcesPhaseId = target.buildPhases.find((id: string) => objects[id].isa === 'PBXSourcesBuildPhase');
      expect(sourcesPhaseId).toBeDefined();
      const sourcesPhase = objects[sourcesPhaseId];

      const builtSourceFiles = sourcesPhase.files.map((fileId: string) => {
        const buildFile = objects[fileId];
        const fileRef = objects[buildFile.fileRef];
        return path.basename(fileRef.path);
      });

      for (const swiftFile of allSwiftFilenames) {
        expect(builtSourceFiles).toContain(swiftFile);
      }
    });

    it('contains valid workspace contents.xcworkspacedata', () => {
      const workspaceContent = fs.readFileSync(workspacePath, 'utf8');
      expect(workspaceContent).toContain('<Workspace');
      expect(workspaceContent).toContain('location = "self:"');
    });
  });
});

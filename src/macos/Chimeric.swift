import AppKit
import WebKit

// This shell has no privileged JavaScript bridge. The existing loopback server
// owns sessions, permissions, research state and model credentials.
struct WorkspaceSession: Decodable {
    let url: URL
    let profile: String
    let origin: URL

    func validated() throws -> WorkspaceSession {
        let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        guard url.scheme == "http", url.host == "127.0.0.1", let port = url.port,
              (1024...65534).contains(port), url.path == "/", url.user == nil,
              url.password == nil, url.fragment == nil,
              parts?.queryItems?.count == 1,
              parts?.queryItems?.first?.name == "nonce",
              let nonce = parts?.queryItems?.first?.value,
              nonce.range(of: "^[a-fA-F0-9]{16,}$", options: .regularExpression) != nil,
              origin.absoluteString == "http://127.0.0.1:\(port)",
              profile.hasPrefix("/") else { throw ShellError.invalidSession }
        return self
    }
}

enum ShellError: LocalizedError {
    case invalidSession, startup, arguments
    var errorDescription: String? {
        switch self {
        case .invalidSession: return "The local workspace returned an invalid session. Retry opening Chimeric."
        case .startup: return "The workspace could not start. Check that its two local ports are available. The private workspace folder contains chimeric-launcher.log."
        case .arguments: return "Use --profile DIRECTORY and --port PORT to open a separate workspace."
        }
    }
}

func workspaceArguments() throws -> [String] {
    var result: [String] = []
    var index = 1
    let args = CommandLine.arguments
    var seen = Set<String>()
    while index < args.count {
        let arg = args[index]
        if arg.hasPrefix("-psn_") { index += 1; continue }
        guard ["--profile", "--port"].contains(arg), index + 1 < args.count,
              seen.insert(arg).inserted, !args[index + 1].hasPrefix("-") else { throw ShellError.arguments }
        result += [arg, args[index + 1]]
        index += 2
    }
    if result.isEmpty, ProcessInfo.processInfo.environment["CHIMERIC_DATA_DIR"] == nil,
       let profile = UserDefaults.standard.string(forKey: "workspaceProfile"), profile.hasPrefix("/") {
        result = ["--profile", profile]
        let port = UserDefaults.standard.integer(forKey: "workspacePort")
        if (1024...65534).contains(port) { result += ["--port", String(port)] }
    }
    return result
}

func helper(_ action: String, arguments: [String], completion: @escaping (Result<Data, Error>) -> Void) {
    DispatchQueue.global(qos: .userInitiated).async {
        do {
            guard let resources = Bundle.main.resourceURL else { throw ShellError.startup }
            let process = Process()
            process.executableURL = resources.appendingPathComponent("bin/chimeric")
            process.arguments = [resources.appendingPathComponent("launcher.mjs").path, action] + arguments
            var environment = ProcessInfo.processInfo.environment
            environment["BUN_BE_BUN"] = "1"
            process.environment = environment
            let output = Pipe()
            process.standardOutput = output
            // Bootstrap nonces travel only through the private stdout pipe.
            process.standardError = FileHandle.nullDevice
            try process.run()
            let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
            DispatchQueue.global().asyncAfter(deadline: .now() + 90, execute: timeout)
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            timeout.cancel()
            guard process.terminationStatus == 0 else { throw ShellError.startup }
            DispatchQueue.main.async { completion(.success(data)) }
        } catch { DispatchQueue.main.async { completion(.failure(error)) } }
    }
}

final class WorkspaceWindow: NSWindowController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    let overlay = NSStackView()
    let message = NSTextField(wrappingLabelWithString: "Opening your workspace…")
    let retry = NSButton(title: "Retry", target: nil, action: nil)
    let progress = NSProgressIndicator()
    var session: WorkspaceSession?
    var arguments: [String]
    var starting = false
    var bootstrapPending = false
    var downloads = [ObjectIdentifier: WKDownload]()
    var pinnedArguments: [String] {
        guard let session = session, let port = session.origin.port else { return arguments }
        return ["--profile", session.profile, "--port", String(port)]
    }

    init(arguments: [String]) {
        self.arguments = arguments
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1220, height: 850),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        super.init(window: window)
        window.title = "Chimeric"
        window.minSize = NSSize(width: 800, height: 600)
        window.setFrameAutosaveName("ChimericWorkspace")
        window.center()
        window.isReleasedWhenClosed = false
        window.backgroundColor = NSColor(calibratedRed: 0.98, green: 0.975, blue: 0.96, alpha: 1)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        let content = window.contentView!
        content.addSubview(webView)
        NSLayoutConstraint.activate([webView.topAnchor.constraint(equalTo: content.topAnchor),
            webView.bottomAnchor.constraint(equalTo: content.bottomAnchor), webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor)])
        overlay.orientation = .vertical
        overlay.spacing = 18
        overlay.alignment = .centerX
        overlay.translatesAutoresizingMaskIntoConstraints = false
        let title = NSTextField(labelWithString: "Chimeric")
        title.font = NSFont.systemFont(ofSize: 28, weight: .medium)
        message.alignment = .center
        message.maximumNumberOfLines = 4
        progress.style = .spinning
        retry.target = self
        retry.action = #selector(start)
        [title, progress, message, retry].forEach { overlay.addArrangedSubview($0) }
        content.addSubview(overlay)
        NSLayoutConstraint.activate([overlay.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            overlay.centerYAnchor.constraint(equalTo: content.centerYAnchor), overlay.widthAnchor.constraint(equalToConstant: 440)])
    }
    required init?(coder: NSCoder) { fatalError("Use init(arguments:)") }

    @objc func start() {
        guard !starting else { return }
        starting = true
        overlay.isHidden = false
        webView.isHidden = true
        message.stringValue = "Opening your workspace…"
        progress.isHidden = false
        progress.startAnimation(nil)
        retry.isHidden = true
        helper("session", arguments: pinnedArguments) { [weak self] result in
            guard let self = self else { return }
            self.starting = false
            do {
                let session = try JSONDecoder().decode(WorkspaceSession.self, from: result.get()).validated()
                self.session = session
                self.bootstrapPending = true
                self.webView.load(URLRequest(url: session.url))
            } catch { self.showError(error.localizedDescription) }
        }
    }
    func showError(_ text: String) {
        overlay.isHidden = false
        webView.isHidden = true
        message.stringValue = text
        retry.isHidden = false
        progress.stopAnimation(nil)
        progress.isHidden = true
    }
    func trusted(_ url: URL?) -> Bool {
        guard let url = url, let origin = session?.origin else { return false }
        return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port && url.user == nil && url.password == nil
    }
    func trustedContent(_ url: URL?) -> Bool {
        guard let url = url else { return false }
        if trusted(url) { return true }
        if ["about:blank", "about:srcdoc"].contains(url.absoluteString) { return true }
        if url.scheme == "blob", let origin = session?.origin.absoluteString { return url.absoluteString.hasPrefix(origin + "/") }
        guard let port = session?.origin.port else { return false }
        return url.scheme == "http" && ["127.0.0.1", "localhost"].contains(url.host ?? "") && url.port == port + 1 && url.user == nil && url.password == nil
    }
    func external(_ url: URL) {
        guard ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? ""), url.user == nil, url.password == nil else { return }
        NSWorkspace.shared.open(url)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame == false { decisionHandler(trustedContent(url) ? .allow : .cancel); return }
        let blob = url.scheme == "blob" && url.absoluteString.hasPrefix((session?.origin.absoluteString ?? "invalid:") + "/")
        if trusted(url) || blob {
            decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
        } else {
            if navigationAction.sourceFrame.isMainFrame && navigationAction.navigationType == .linkActivated { external(url) }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard navigationResponse.isForMainFrame ? trusted(navigationResponse.response.url) || navigationResponse.response.url?.scheme == "blob" : trustedContent(navigationResponse.response.url) else { decisionHandler(.cancel); return }
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Submit only the existing same-origin one-use bootstrap form. The server
        // validates its nonce and sets the normal local cookie/CSRF session.
        if bootstrapPending && trusted(webView.url) {
            bootstrapPending = false
            webView.evaluateJavaScript("""
            (() => { const f = [...document.forms].find(f => {
              const u = new URL(f.action, location.href);
              return u.origin === location.origin && u.pathname === '/api/auth/nonce' && f.method.toLowerCase() === 'post';
            }); if (f) { f.requestSubmit(); return true; } return false; })()
            """) { [weak self] value, error in
                if error != nil { self?.showError("The local session could not open. Please retry.") }
                else if value as? Bool != true { self?.reveal() }
            }
        } else { reveal() }
    }
    func reveal() { overlay.isHidden = true; webView.isHidden = false; window?.makeFirstResponder(webView) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showError("The local workspace is unavailable. Retry to reconnect.") }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { showError("The window needs to reconnect to your workspace. Your research continues in the background.") }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.sourceFrame.isMainFrame, let url = navigationAction.request.url else { return nil }
        if trusted(url) { webView.load(navigationAction.request) } else { external(url) }
        return nil
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard frame.isMainFrame, trusted(webView.url), let window = window else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard frame.isMainFrame, trusted(webView.url), let window = window else { completionHandler(); return }
        let alert = NSAlert(); alert.messageText = "Chimeric"; alert.informativeText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard frame.isMainFrame, trusted(webView.url), let window = window else { completionHandler(false); return }
        let alert = NSAlert(); alert.messageText = "Chimeric"; alert.informativeText = message
        alert.addButton(withTitle: "Continue"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { retainDownload(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { retainDownload(download) }
    func retainDownload(_ download: WKDownload) { downloads[ObjectIdentifier(download)] = download; download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard let window = window else { completionHandler(nil); return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = (suggestedFilename as NSString).lastPathComponent
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.url : nil) }
    }
    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        decisionHandler(trusted(request.url) ? .allow : .cancel)
    }
    func downloadDidFinish(_ download: WKDownload) { downloads.removeValue(forKey: ObjectIdentifier(download)) }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
        if (error as NSError).code != NSURLErrorCancelled {
            let alert = NSAlert(); alert.messageText = "Download could not finish"; alert.informativeText = "Try downloading the file again from Files."
            if let window = window { alert.beginSheetModal(for: window) }
        }
    }
}

final class ChimericApp: NSObject, NSApplicationDelegate {
    var windows = [WorkspaceWindow]()
    var arguments = [String]()
    var active: WorkspaceWindow? { windows.first { $0.window?.isKeyWindow == true } ?? windows.last }
    func applicationDidFinishLaunching(_ notification: Notification) {
        do { arguments = try workspaceArguments() }
        catch { let alert = NSAlert(); alert.messageText = "Chimeric launch options"; alert.informativeText = error.localizedDescription; alert.runModal(); NSApp.terminate(nil); return }
        makeMenus()
        newWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { if let last = windows.last { last.showWindow(nil) } else { newWindow(nil) } }
        return true
    }
    @objc func newWindow(_ sender: Any?) {
        let nextArguments = active?.pinnedArguments ?? arguments
        windows.removeAll { $0.window?.isVisible == false }
        let controller = WorkspaceWindow(arguments: nextArguments)
        windows.append(controller); controller.showWindow(nil); controller.start()
    }
    @objc func openWorkspace(_ sender: Any?) {
        let panel = NSOpenPanel(); panel.title = "Open Chimeric Workspace"
        panel.message = "Choose an existing workspace folder, or create an empty folder for a new workspace."
        panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        let controller = WorkspaceWindow(arguments: ["--profile", folder.path])
        windows.append(controller); controller.showWindow(nil); controller.start()
    }
    @objc func defaultWorkspace(_ sender: Any?) {
        guard let session = active?.session else { return }
        UserDefaults.standard.set(session.profile, forKey: "workspaceProfile")
        UserDefaults.standard.set(session.origin.port, forKey: "workspacePort")
    }
    @objc func settings(_ sender: Any?) {
        guard let active = active, active.trusted(active.webView.url) else { return }
        active.webView.evaluateJavaScript("window.dispatchEvent(new Event('chimeric-open-settings'))")
    }
    @objc func reload(_ sender: Any?) { active?.start() }
    @objc func back(_ sender: Any?) { active?.webView.goBack() }
    @objc func forward(_ sender: Any?) { active?.webView.goForward() }
    @objc func zoomIn(_ sender: Any?) { if let view = active?.webView { view.pageZoom = min(2, view.pageZoom + 0.1) } }
    @objc func zoomOut(_ sender: Any?) { if let view = active?.webView { view.pageZoom = max(0.6, view.pageZoom - 0.1) } }
    @objc func actualSize(_ sender: Any?) { active?.webView.pageZoom = 1 }
    @objc func dataFolder(_ sender: Any?) { if let path = active?.session?.profile { NSWorkspace.shared.open(URL(fileURLWithPath: path, isDirectory: true)) } }
    @objc func browser(_ sender: Any?) { helper("open", arguments: active?.pinnedArguments ?? arguments) { [weak self] result in
        if case .failure = result { self?.active?.showError("The browser could not open. Your workspace remains available in this window.") }
    } }
    @objc func help(_ sender: Any?) { if let origin = active?.session?.origin { active?.webView.load(URLRequest(url: origin.appendingPathComponent("api/local/help"))) } }
    @objc func stopWorkspace(_ sender: Any?) {
        guard let window = active?.window else { return }
        let alert = NSAlert(); alert.messageText = "Stop this workspace?"
        alert.informativeText = "Running research and compute will stop. Your saved projects remain in the workspace folder."
        alert.addButton(withTitle: "Stop Workspace and Quit"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { [weak self] response in
            guard response == .alertFirstButtonReturn, let self = self else { return }
            // Pin the resolved profile so this action cannot stop another profile
            // after an external configuration edit.
            let args = self.active?.session.map { ["--profile", $0.profile] } ?? self.arguments
            helper("stop", arguments: args) { result in
                switch result {
                case .success: NSApp.terminate(nil)
                case .failure: self.active?.showError("The workspace could not stop. Check its private launcher log, then retry.")
                }
            }
        }
    }
    func makeMenus() {
        let bar = NSMenu()
        func menu(_ title: String) -> NSMenu { let item = NSMenuItem(); let child = NSMenu(title: title); item.submenu = child; bar.addItem(item); return child }
        func add(_ menu: NSMenu, _ title: String, _ action: Selector?, _ key: String = "", _ target: AnyObject? = nil) {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key); item.target = target; menu.addItem(item)
        }
        let app = menu("Chimeric")
        add(app, "About Chimeric", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), "", NSApp)
        app.addItem(.separator()); add(app, "Settings…", #selector(settings(_:)), ",", self)
        add(app, "Show Workspace Folder", #selector(dataFolder(_:)), "", self)
        add(app, "Use This Workspace at Launch", #selector(defaultWorkspace(_:)), "", self)
        add(app, "Open in Browser", #selector(browser(_:)), "", self)
        app.addItem(.separator()); add(app, "Hide Chimeric", #selector(NSApplication.hide(_:)), "h", NSApp)
        add(app, "Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", NSApp)
        app.items.last?.keyEquivalentModifierMask = [.command, .option]
        add(app, "Show All", #selector(NSApplication.unhideAllApplications(_:)), "", NSApp)
        app.addItem(.separator()); add(app, "Stop Workspace and Quit…", #selector(stopWorkspace(_:)), "", self)
        add(app, "Quit Chimeric", #selector(NSApplication.terminate(_:)), "q", NSApp)
        let file = menu("File"); add(file, "New Window", #selector(newWindow(_:)), "n", self)
        add(file, "Open Workspace…", #selector(openWorkspace(_:)), "o", self)
        add(file, "Close Window", #selector(NSWindow.performClose(_:)), "w")
        let edit = menu("Edit")
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] { add(edit, title, Selector(selector), key) }
        let view = menu("View"); add(view, "Back", #selector(back(_:)), "[", self); add(view, "Forward", #selector(forward(_:)), "]", self)
        add(view, "Reload Workspace", #selector(reload(_:)), "r", self)
        view.addItem(.separator()); add(view, "Zoom In", #selector(zoomIn(_:)), "+", self); add(view, "Zoom Out", #selector(zoomOut(_:)), "-", self); add(view, "Actual Size", #selector(actualSize(_:)), "0", self)
        let window = menu("Window"); add(window, "Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"); add(window, "Zoom", #selector(NSWindow.performZoom(_:)))
        NSApp.windowsMenu = window
        let helpMenu = menu("Help"); add(helpMenu, "Chimeric Help", #selector(help(_:)), "", self); NSApp.helpMenu = helpMenu
        NSApp.mainMenu = bar
    }
}

let app = NSApplication.shared
let delegate = ChimericApp()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()

import Foundation
import LocalAuthentication

// Helper Touch ID / password di sistema per Termilal.
// Exit 0 = autenticato, 1 = fallito/annullato, 2 = non disponibile.
let ctx = LAContext()
var err: NSError?
let policy: LAPolicy = .deviceOwnerAuthentication
guard ctx.canEvaluatePolicy(policy, error: &err) else {
    FileHandle.standardError.write("LA non disponibile: \(err?.localizedDescription ?? "?")\n".data(using: .utf8)!)
    exit(2)
}
let sem = DispatchSemaphore(value: 0)
var ok = false
ctx.evaluatePolicy(policy, localizedReason: "Sblocca Termilal") { success, _ in
    ok = success
    sem.signal()
}
sem.wait()
exit(ok ? 0 : 1)

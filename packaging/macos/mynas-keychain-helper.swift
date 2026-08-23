import Foundation
import Security

struct KeychainRequest: Decodable {
    let account: String
    let action: String
    let service: String
    let value: String?
}

enum HelperError: Error {
    case invalidRequest(String)
    case keychain(OSStatus)
}

func query(_ request: KeychainRequest) -> [String: Any] {
    [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: request.account,
        kSecAttrService as String: request.service,
    ]
}

func requireSuccess(_ status: OSStatus) throws {
    if status != errSecSuccess {
        throw HelperError.keychain(status)
    }
}

func writeResponse(_ value: [String: String] = [:]) throws {
    let data = try JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

func run(_ request: KeychainRequest) throws {
    guard !request.account.isEmpty, !request.service.isEmpty else {
        throw HelperError.invalidRequest("account and service are required")
    }
    switch request.action {
    case "put":
        guard let encoded = request.value, let value = Data(base64Encoded: encoded) else {
            throw HelperError.invalidRequest("put requires a base64 value")
        }
        SecItemDelete(query(request) as CFDictionary)
        var attributes = query(request)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        attributes[kSecValueData as String] = value
        try requireSuccess(SecItemAdd(attributes as CFDictionary, nil))
        try writeResponse()
    case "get":
        var attributes = query(request)
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        attributes[kSecReturnData as String] = true
        var result: CFTypeRef?
        try requireSuccess(SecItemCopyMatching(attributes as CFDictionary, &result))
        guard let value = result as? Data else {
            throw HelperError.invalidRequest("Keychain item did not return data")
        }
        try writeResponse(["value": value.base64EncodedString()])
    case "delete":
        let status = SecItemDelete(query(request) as CFDictionary)
        if status != errSecSuccess, status != errSecItemNotFound {
            throw HelperError.keychain(status)
        }
        try writeResponse()
    default:
        throw HelperError.invalidRequest("unsupported action")
    }
}

do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let request = try JSONDecoder().decode(KeychainRequest.self, from: input)
    try run(request)
} catch let HelperError.keychain(status) {
    let message = SecCopyErrorMessageString(status, nil) as String? ?? "unknown Keychain error"
    FileHandle.standardError.write(Data("Keychain operation failed: \(message)\n".utf8))
    exit(1)
} catch {
    FileHandle.standardError.write(Data("Keychain helper failed: \(error)\n".utf8))
    exit(1)
}

//
//  NetworkError.swift
//  GymBooker
//
//  Created by Chris Simmonds on 17/04/2025.
//


import Foundation

enum NetworkError: Error {
  case badURL, requestFailed, decodingFailed
}

class NetworkManager {
    static let shared = NetworkManager()
    private init() {}
    
    // Replace with your actual endpoints:
    private let classesURL = URL(string: "https://chrissimmonds60.github.io/gymbooker/classes.json")!
    //  private let bookURL    = URL(string: "https://<your‑domain>/book")!
    
    func fetchClasses() async throws -> [GymClass] {
        let (data, response) = try await URLSession.shared.data(from: classesURL)
        // Log raw classes JSON for debugging
        if let jsonString = String(data: data, encoding: .utf8) {
            print("📡 Raw classes JSON: \(jsonString)")
        } else {
            print("⚠️ Unable to stringify classes JSON")
        }
        do {
            let classes = try JSONDecoder().decode([GymClass].self, from: data)
            print("✅ Decoded classes count: \(classes.count)")
            return classes
        } catch {
            print("❌ Decoding failed with error: \(error)")
            throw NetworkError.decodingFailed
        }
    }
}
//  func book(_ gymClass: GymClass) async throws {
//    var req = URLRequest(url: bookURL)
//    req.httpMethod = "POST"
//    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
//    let body = [
//      "club": gymClass.club,
//      "time": gymClass.time,
//      "title": gymClass.title
//    ]
//    req.httpBody = try JSONEncoder().encode(body)
//
//    let (_, response) = try await URLSession.shared.data(for: req)
//    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
//      throw NetworkError.requestFailed
//    }
//  }
//}

import Foundation
import Vision
import ImageIO

struct Label: Encodable {
    let text: String
    let confidence: Float
    let box: [Double]
}

let path = CommandLine.arguments[1]
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]
request.minimumTextHeight = 0.005
try VNImageRequestHandler(url: URL(fileURLWithPath: path)).perform([request])
let labels = (request.results ?? []).compactMap { observation -> Label? in
    guard let text = observation.topCandidates(1).first else { return nil }
    let box = observation.boundingBox
    return Label(text: text.string, confidence: text.confidence,
                 box: [box.minX, 1 - box.maxY, box.maxX, 1 - box.minY])
}
FileHandle.standardOutput.write(try JSONEncoder().encode(labels))

import Foundation
import Testing

@testable import MTPUSB

@Suite("USB interface language identification")
struct USBInterfaceIdentificationTests {
  @Test func descriptorZeroDecodesReportedLanguagesAndBounds() throws {
    let descriptor = Data([10, 3, 0x11, 0x04, 0x07, 0x04, 0x11, 0x04, 0, 0, 0xDE, 0xAD])
    #expect(try USBInterfaceIdentification.languageIDs(from: descriptor) == [0x0411, 0x0407])
  }

  @Test(arguments: [
    Data(), Data([2, 3]), Data([3, 3, 9]), Data([6, 3, 9, 4]),
    Data([4, 2, 9, 4]), Data([4, 3, 0, 0]),
  ])
  func malformedOrEmptyLanguageListsAreRejected(_ descriptor: Data) {
    #expect(throws: USBTransportError.self) {
      _ = try USBInterfaceIdentification.languageIDs(from: descriptor)
    }
  }

  @Test func nonEnglishInterfaceAndFailedFirstLanguageStillMatch() throws {
    var attempted = [UInt16]()
    let name = try USBInterfaceIdentification.mtpName(
      index: 7,
      languageDescriptor: { Data([6, 3, 0x11, 0x04, 0x07, 0x04]) },
      string: { index, language in
        #expect(index == 7)
        attempted.append(language)
        if language == 0x0411 { throw CocoaError(.fileReadUnknown) }
        return "Android mtp interface"
      })
    #expect(name == "Android mtp interface")
    #expect(attempted == [0x0411, 0x0407])
  }

  @Test func nonMTPNamesDoNotBecomeCandidatesAfterAllLanguagesAreTried() {
    var attempted = [UInt16]()
    #expect(throws: USBTransportError.self) {
      _ = try USBInterfaceIdentification.mtpName(
        index: 2, languageDescriptor: { Data([6, 3, 0x09, 0x04, 0x11, 0x04]) },
        string: { _, language in
          attempted.append(language)
          return "ADB interface"
        })
    }
    #expect(attempted == [0x0409, 0x0411])
  }

  @Test func missingInterfaceNameDoesNotIssueStringRequests() {
    var requested = false
    #expect(throws: USBTransportError.self) {
      _ = try USBInterfaceIdentification.mtpName(
        index: 0,
        languageDescriptor: {
          requested = true
          return Data([4, 3, 9, 4])
        },
        string: { _, _ in
          requested = true
          return "MTP"
        })
    }
    #expect(!requested)
  }
}

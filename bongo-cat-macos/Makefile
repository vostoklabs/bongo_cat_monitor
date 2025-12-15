# Bongo Cat Native macOS App - Build System
#
# Usage:
#   make          - Build everything (Rust daemon + Swift app + bundle)
#   make clean    - Clean all build artifacts
#   make run      - Build and run the app

RUST_SRC = bongocat-daemon
SWIFT_SRC = BongoCatApp
BUILD_DIR = build
RUST_BINARY = $(RUST_SRC)/target/release/bongocat-daemon
SWIFT_APP = $(BUILD_DIR)/BongoCat.app
SWIFT_BINARY = $(SWIFT_APP)/Contents/MacOS/BongoCat
BUNDLE_RESOURCES = $(SWIFT_APP)/Contents/Resources

SWIFT_FILES = $(wildcard $(SWIFT_SRC)/BongoCat/*.swift)

.PHONY: all clean build-rust build-swift bundle codesign run

# Default target: build everything
all: bundle codesign
	@echo "Build complete: $(SWIFT_APP)"

# Build Rust daemon
build-rust:
	@echo "Building Rust daemon..."
	cd $(RUST_SRC) && cargo build --release

# Build Swift app using swiftc directly
build-swift: $(SWIFT_BINARY)

$(SWIFT_BINARY): $(SWIFT_FILES)
	@echo "Building Swift app..."
	@mkdir -p $(SWIFT_APP)/Contents/MacOS
	@mkdir -p $(SWIFT_APP)/Contents/Resources
	swiftc -O \
		-sdk $(shell xcrun --show-sdk-path) \
		-target arm64-apple-macosx12.0 \
		-framework AppKit \
		-framework SwiftUI \
		-framework ApplicationServices \
		$(SWIFT_FILES) \
		-o $(SWIFT_BINARY)
	@cp $(SWIFT_SRC)/BongoCat/Info.plist $(SWIFT_APP)/Contents/

# Bundle: copy Rust binary into app bundle
bundle: build-rust build-swift
	@echo "Creating app bundle..."
	@mkdir -p "$(BUNDLE_RESOURCES)"
	cp "$(RUST_BINARY)" "$(BUNDLE_RESOURCES)/bongocat-daemon"
	chmod +x "$(BUNDLE_RESOURCES)/bongocat-daemon"

# Code sign the app (ad-hoc for personal use)
codesign:
	@echo "Code signing..."
	codesign --force --deep --sign - "$(SWIFT_APP)"

# Clean all build artifacts
clean:
	@echo "Cleaning..."
	cd $(RUST_SRC) && cargo clean
	rm -rf $(BUILD_DIR)

# Build and run
run: all
	@echo "Launching Bongo Cat..."
	open "$(SWIFT_APP)"

# Run Rust tests
test-rust:
	cd $(RUST_SRC) && cargo test

# Check Rust code
check:
	cd $(RUST_SRC) && cargo check

# Format Rust code
fmt:
	cd $(RUST_SRC) && cargo fmt

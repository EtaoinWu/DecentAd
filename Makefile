CIRCOM := circom
SNARKJS := snarkjs
RM := rm
MKDIR := mkdir
RMDIR := rm -rf
NODE := node

CIRCOM_FLAGS := --r1cs --wasm --sym --c --O2

SRC_DIR := ./circuit
BUILD_DIR ?= ./out

PTAU := $(BUILD_DIR)/my.ptau

CIRCUITS := $(wildcard $(SRC_DIR)/*.circom)
CIRCUITPPS := $(wildcard $(SRC_DIR)/*.circompp)
CIRCUIT_NAMES := $(CIRCUITS:$(SRC_DIR)/%.circom=%.c) $(CIRCUITPPS:$(SRC_DIR)/%.circompp=%.p)
DEPS := $(CIRCUITPPS:$(SRC_DIR)/%.circompp=$(BUILD_DIR)/%.p.d)
GENERATED_CIRCUITS := $(CIRCUIT_NAMES:%=$(BUILD_DIR)/%.circom)
R1CSS := $(CIRCUIT_NAMES:%=$(BUILD_DIR)/%.r1cs)
ZKEYS := $(CIRCUIT_NAMES:%=$(BUILD_DIR)/%.000.zkey)
ZKEY_FINALS := $(CIRCUIT_NAMES:%=$(BUILD_DIR)/%.final.zkey)
VKEYS := $(CIRCUIT_NAMES:%=$(BUILD_DIR)/%.vkey.json)

INPUTS := $(CIRCUIT_NAMES:%=$(SRC_DIR)/%.input.json)
WITNESSES := $(CIRCUIT_NAMES:%=$(BUILD_DIR)/%.wtns)

PROOFS := $(CIRCUIT_NAMES:%=$(BUILD_DIR)/%.proof.json)
PUBLICS := $(CIRCUIT_NAMES:%=$(BUILD_DIR)/%.public.json)

VERIFYS := $(CIRCUIT_NAMES:%=$(BUILD_DIR)/%_verify)

# Main target
all: ptau build witness create_keys prove verify

qwq:
	@echo $(CIRCUIT_NAMES)
	@echo $(WITNESSES)
	@echo $(VERIFYS)
	@echo $(DEPS)

.PHONY : ptau
ptau: $(PTAU)

$(BUILD_DIR):
	$(MKDIR) -p $@

$(BUILD_DIR)/%.ptau:
	@mkdir -p $(BUILD_DIR)
	$(SNARKJS) powersoftau new bn128 14 $@.phase1
	$(SNARKJS) powersoftau prepare phase2 $@.phase1 $@

.PHONY : build
build: $(GENERATED_CIRCUITS) $(R1CSS)

$(BUILD_DIR)/%.c.circom: $(SRC_DIR)/%.circom
	@mkdir -p $(BUILD_DIR)
	cp $< $@

$(BUILD_DIR)/%.p.circom: $(SRC_DIR)/%.circompp
	@mkdir -p $(BUILD_DIR)
	gcc -E -x c -P -C -I $(SRC_DIR) -I $(BUILD_DIR) -MMD -MP -MT $@ -o $@ $<

$(BUILD_DIR)/%.r1cs: $(BUILD_DIR)/%.circom
	@mkdir -p $(BUILD_DIR)
	$(CIRCOM) $< -o $(dir $@) $(CIRCOM_FLAGS) 

$(BUILD_DIR)/%.000.zkey: $(BUILD_DIR)/%.r1cs $(PTAU)
	$(SNARKJS) groth16 setup $< $(PTAU) $@

$(BUILD_DIR)/%.final.zkey: $(BUILD_DIR)/%.000.zkey
	$(SNARKJS) zkey beacon $< $@ 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10

$(BUILD_DIR)/%.vkey.json: $(BUILD_DIR)/%.final.zkey
	$(SNARKJS) zkey export verificationkey $< $@

.PHONY : create_keys
create_keys: $(ZKEYS) $(ZKEY_FINALS) $(VKEYS)

$(BUILD_DIR)/%.wtns: $(SRC_DIR)/%.input.json $(BUILD_DIR)/%.r1cs
	$(NODE) $(BUILD_DIR)/$(*F)_js/generate_witness.js $(BUILD_DIR)/$(*F)_js/$(*F).wasm $< $@

$(BUILD_DIR)/%.proof.json: $(BUILD_DIR)/%.final.zkey $(BUILD_DIR)/%.wtns
	$(SNARKJS) groth16 prove $^ $@ $(BUILD_DIR)/$(*F).public.json

$(BUILD_DIR)/%.public.json: $(BUILD_DIR)/%.proof.json

.PHONY : witness
witness: $(WITNESSES)

.PHONY : prove
prove: witness $(PROOFS) $(PUBLICS)

.PHONY : verify 
verify: $(VERIFYS)

.PHONE : $(VERIFYS)
$(BUILD_DIR)/%_verify: $(BUILD_DIR)/%.vkey.json $(BUILD_DIR)/%.public.json $(BUILD_DIR)/%.proof.json
	$(SNARKJS) groth16 verify $^

.PHONY : clean
clean:
	mv $(PTAU) ptau/
	$(RMDIR) $(BUILD_DIR)
	$(MKDIR) -p $(BUILD_DIR)
	mv ptau/my.ptau $(PTAU)

-include $(DEPS)
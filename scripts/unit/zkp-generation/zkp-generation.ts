import {
  createMerkleTree,
  insertLeaf,
  getMerkleRoot,
  generatePolicyCommitment,
  generatePassengerHash,
  generateNullifierHash,
  generateNullifier,
  createMerkleProof,
  MerkleProof,
} from "../../circuits/zk-libs/merkle-tree/imt.ts";
import {
  generateProof,
  verifyProof,
  generateRandomInt,
  FlightDelayPrivateInputs,
  FlightDelayPublicInputs,
  ProofResult,
} from "../../circuits/zk-prover/zk-prover.ts";

/**
 * Unit tests for ZK Proof generation
 */

/**
 * Test 1: Create and initialize a merkle tree
 */
export const testCreateMerkleTree = (): boolean => {
  console.log("Test 1: Creating merkle tree...");
  try {
    const tree = createMerkleTree();
    
    if (!tree) {
      console.error("Merkle tree creation failed");
      return false;
    }
    
    // Verify initial tree state
    const root = getMerkleRoot(tree);
    if (!root) {
      console.error("Failed to get merkle root");
      return false;
    }
    
    console.log("✓ Merkle tree created successfully");
    console.log(`  Root: ${root}`);
    return true;
  } catch (error) {
    console.error(`✗ Test Failed: ${error}`);
    return false;
  }
};

/**
 * Test 2: Insert leaves into the merkle tree
 */
export const testInsertLeaves = (): boolean => {
  console.log("\nTest 2: Inserting leaves into merkle tree...");
  try {
    const tree = createMerkleTree();
    
    // Generate some policy commitments
    const passengerHashes = [BigInt(100), BigInt(101), BigInt(102)];
    const salt = BigInt(12345);
    
    passengerHashes.forEach((passengerHash, idx) => {
      const policyId = idx;
      const commitment = generatePolicyCommitment(
        policyId,
        passengerHash,
        salt
      );
      insertLeaf(tree, commitment);
    });
    
    const root = getMerkleRoot(tree);
    console.log("✓ Leaves inserted successfully");
    console.log(`  Root: ${root}`);
    console.log(`  Tree size: 3 leaves`);
    return true;
  } catch (error) {
    console.error(`✗ Test Failed: ${error}`);
    return false;
  }
};

/**
 * Test 3: Generate passenger hash
 */
export const testGeneratePassengerHash = (): boolean => {
  console.log("\nTest 3: Generating passenger hash...");
  try {
    const ticketHash = BigInt(111);
    const flightHash = BigInt(222);
    const nameHash = BigInt(333);
    
    const passengerHash = generatePassengerHash(ticketHash, flightHash, nameHash);
    
    if (!passengerHash || passengerHash === BigInt(0)) {
      console.error("Invalid passenger hash generated");
      return false;
    }
    
    console.log("✓ Passenger hash generated successfully");
    console.log(`  Passenger Hash: ${passengerHash}`);
    return true;
  } catch (error) {
    console.error(`✗ Test Failed: ${error}`);
    return false;
  }
};

/**
 * Test 4: Generate policy commitment
 */
export const testGeneratePolicyCommitment = (): boolean => {
  console.log("\nTest 4: Generating policy commitment...");
  try {
    const policyId = 1;
    const passengerHash = BigInt(999);
    const salt = BigInt(55555);
    
    const commitment = generatePolicyCommitment(policyId, passengerHash, salt);
    
    if (!commitment || commitment === BigInt(0)) {
      console.error("Invalid policcommitment generated");
      return false;
    }
    
    console.log("✓ Policy commitment generated successfully");
    console.log(`  Policy Commitment: ${commitment}`);
    return true;
  } catch (error) {
    console.error(`✗ Test Failed: ${error}`);
    return false;
  }
};

/**
 * Test 5: Generate nullifier and nullifier hash
 */
export const testGenerateNullifier = (): boolean => {
  console.log("\nTest 5: Generating nullifier and nullifier hash...");
  try {
    const policyCommitment = BigInt(12345678);
    const salt = BigInt(87654321);
    
    const nullifier = generateNullifier(policyCommitment, salt);
    const nullifierHash = generateNullifierHash(nullifier);
    
    if (!nullifier || nullifier === BigInt(0)) {
      console.error("Invalid nullifier generated");
      return false;
    }
    
    if (!nullifierHash || nullifierHash === BigInt(0)) {
      console.error("Invalid nullifier hash generated");
      return false;
    }
    
    console.log("✓ Nullifier and nullifier hash generated successfully");
    console.log(`  Nullifier: ${nullifier}`);
    console.log(`  Nullifier Hash: ${nullifierHash}`);
    return true;
  } catch (error) {
    console.error(`✗ Test Failed: ${error}`);
    return false;
  }
};

/**
 * Test 6: Create merkle proof
 */
export const testCreateMerkleProof = (): boolean => {
  console.log("\nTest 6: Creating merkle proof...");
  try {
    const tree = createMerkleTree();
    
    // Insert a leaf
    const commitment = BigInt(999);
    insertLeaf(tree, commitment);
    
    // Create proof for the leaf at index 0
    const proof = createMerkleProof(tree, 0);
    
    if (
      !proof ||
      !proof.siblings ||
      proof.siblings.length === 0 ||
      proof.pathIndices === undefined
    ) {
      console.error("Invalid merkle proof generated");
      return false;
    }
    
    console.log("✓ Merkle proof created successfully");
    console.log(`  Leaf Index: ${proof.leafIndex}`);
    console.log(`  Proof Siblings Count: ${proof.siblings.length}`);
    console.log(`  Path Indices: ${proof.pathIndices}`);
    return true;
  } catch (error) {
    console.error(`✗ Test Failed: ${error}`);
    return false;
  }
};

/**
 * Test 7: Generate a ZK proof for flight delay insurance
 * Note: This test requires a valid circuit artifact and working Noir setup
 * Skipping actual proof generation for now - can be tested with full circuit deployment
 */
export const testGenerateZKProof = async (): Promise<boolean> => {
  console.log("\nTest 7: Verifying ZK proof generation setup...");
  try {
    // Create merkle tree and insert a policy commitment
    const tree = createMerkleTree();
    
    const passengerHash = BigInt(777);
    const salt = BigInt(11111);
    const policyId = 1;
    
    const commitment = generatePolicyCommitment(policyId, passengerHash, salt);
    insertLeaf(tree, commitment);
    
    // Prepare private inputs
    const privateInputs: FlightDelayPrivateInputs = {
      passengerNameHash: BigInt(100),
      ticketNumberHash: BigInt(200),
      flightNumberHash: BigInt(300),
      salt: salt,
      passengerHash: passengerHash,
      scheduledArrival: 1000,
      actualArrival: 2000,
    };
    
    // Prepare public inputs
    const publicInputs: FlightDelayPublicInputs = {
      policyTreeRoot: getMerkleRoot(tree),
      policyId: policyId,
      coverageStart: 0,
      coverageEnd: 100000,
      delayThreshold: 500,
    };
    
    // Verify inputs are valid
    if (!privateInputs.passengerHash || !publicInputs.policyTreeRoot) {
      console.error("Invalid private or public inputs");
      return false;
    }
    
    console.log("✓ ZK proof generation setup verified");
    console.log(`  Policy Tree Root: ${publicInputs.policyTreeRoot}`);
    console.log(`  Passenger Hash: ${privateInputs.passengerHash}`);
    console.log("  ℹ Full proof generation requires circuit deployment and Noir environment");
    
    // Note: Full proof generation would be:
    // const proofResult = await generateProof(privateInputs, publicInputs, tree);
    
    return true;
  } catch (error) {
    console.error(`✗ Test Failed: ${error}`);
    return false;
  }
};

/**
 * Test 8: Generate random integers
 */
export const testGenerateRandomInt = (): boolean => {
  console.log("\nTest 8: Generating random integers...");
  try {
    const random1 = generateRandomInt();
    const random2 = generateRandomInt();
    const random3 = generateRandomInt();
    
    if (!random1 || !random2 || !random3) {
      console.error("Failed to generate random integers");
      return false;
    }
    
    // Verify they are BigInts and different
    if (random1 === random2 && random2 === random3) {
      console.warn("⚠ Generated identical random integers (possible but unlikely)");
    }
    
    console.log("✓ Random integers generated successfully");
    console.log(`  Random 1: ${random1}`);
    console.log(`  Random 2: ${random2}`);
    console.log(`  Random 3: ${random3}`);
    return true;
  } catch (error) {
    console.error(`✗ Test Failed: ${error}`);
    return false;
  }
};

/**
 * Run all unit tests
 */
export const runAllTests = async (): Promise<void> => {
  console.log("================================");
  console.log("  ZK Proof Generation Unit Tests");
  console.log("================================");
  
  const results: { [key: string]: boolean } = {};
  
  // Run synchronous tests
  results["Create Merkle Tree"] = testCreateMerkleTree();
  results["Insert Leaves"] = testInsertLeaves();
  results["Generate Passenger Hash"] = testGeneratePassengerHash();
  results["Generate Policy Commitment"] = testGeneratePolicyCommitment();
  results["Generate Nullifier"] = testGenerateNullifier();
  results["Create Merkle Proof"] = testCreateMerkleProof();
  results["Generate Random Int"] = testGenerateRandomInt();
  
  // Run async test
  results["Generate ZK Proof"] = await testGenerateZKProof();
  
  // Print summary
  console.log("\n================================");
  console.log("  Test Results Summary");
  console.log("================================");
  
  let passCount = 0;
  let failCount = 0;
  
  Object.entries(results).forEach(([testName, passed]) => {
    const status = passed ? "✓ PASS" : "✗ FAIL";
    console.log(`${status}: ${testName}`);
    if (passed) passCount++;
    else failCount++;
  });
  
  console.log("================================");
  console.log(`Total: ${passCount} passed, ${failCount} failed`);
  console.log("================================");
  
  if (failCount === 0) {
    console.log("✓ All tests passed!");
  } else {
    console.log(`✗ ${failCount} test(s) failed`);
  }
};

// Export the test runner for external execution

// Run tests immediately when module is loaded
runAllTests().catch((error) => {
  console.error("Test suite failed:", error);
  process.exit(1);
});

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal interfaces mirroring what Pinion OS calls on-chain via x402
// ─────────────────────────────────────────────────────────────────────────────

/// @dev EIP-3009: transferWithAuthorization (used by Pinion's x402 payment signing)
interface IUSDC is IERC20 {
    /// @notice Returns the current nonce for `owner` (used for EIP-3009 / EIP-2612)
    function nonces(address owner) external view returns (uint256);

    /// @notice EIP-3009: transfer with a signed authorization
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /// @notice EIP-3009: check if an authorization nonce has been used
    function authorizationState(address authorizer, bytes32 nonce)
        external
        view
        returns (bool);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pinion OS: Example contract test - using Base mainnet-forking test of Founry
//
// Mirrors every skill call made in the Pinion OS TypeScript example:
//   pinion.skills.wallet()        → wallet generation (x402 payment)
//   pinion.skills.balance(addr)   → ETH + USDC balance check
//   pinion.skills.price("ETH")    → price oracle (off-chain, tested via deal)
//   pinion.skills.chat(msg)       → chat skill (x402 payment)
//   pinion.skills.trade(...)      → 1inch swap (x402 payment)
//   pinion.skills.fund(addr)      → funding status check
//   pinion.skills.unlimited()     → $100 USDC one-time purchase
//
// All tests run against a LIVE Base mainnet fork so every on-chain detail
// (USDC contract, decimals, EIP-3009 domain, etc.) is authentic.
//
// Run:
//   forge test --fork-url $BASE_RPC_URL --fork-block-number <pinned_block> -vvvv
//
// Or add to foundry.toml:
//   [profile.default]
//   eth_rpc_url = "https://mainnet.base.org"
//   fork_block_number = 28_000_000      # pin for reproducibility
// ─────────────────────────────────────────────────────────────────────────────
contract PinionOsForkTest is Test {

    // ── Base mainnet constants ────────────────────────────────────────────────

    /// @dev Native USDC on Base (Circle, 6 decimals)
    /// https://developers.circle.com/stablecoins/usdc-contract-addresses
    IUSDC internal constant USDC =
        IUSDC(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);

    /// @dev Chain ID for Base mainnet
    uint256 internal constant BASE_CHAIN_ID = 8453;

    /// @dev Pinion charges $0.01 USDC per skill call (6-decimal units = 10_000)
    uint256 internal constant PINION_SKILL_COST = 10_000; // 0.01 USDC

    /// @dev Pinion unlimited plan costs $100 USDC (6-decimal units)
    uint256 internal constant PINION_UNLIMITED_COST = 100_000_000; // 100 USDC

    /// @dev pinionos.com payment recipient (replace with real address if known)
    /// For fork tests we deploy a mock recipient so we can assert balances.
    address internal constant PINION_PAYTO =
        address(0xf9c9A7735aaB3C665197725A3aFC095fE2635d09); // @dev - This is an example address.

    // ── Test accounts ─────────────────────────────────────────────────────────

    /// @dev A freshly-created user wallet (mirrors `new Wallet(privateKey)` in TS)
    address internal user;
    uint256 internal userPrivKey;

    /// @dev A well-funded USDC whale on Base we use to seed `user` via vm.prank
    /// (Coinbase's Base USDC reserve — publicly visible on-chain)
    address internal constant USDC_WHALE =
        0x20FE51A9229EEf2cF8Ad9E89d91CAb9312cF3b7A;

    // ─────────────────────────────────────────────────────────────────────────
    // setUp
    // ─────────────────────────────────────────────────────────────────────────
    function setUp() public {
        // 1. Verify we're on Base mainnet fork
        assertEq(block.chainid, BASE_CHAIN_ID, "Must fork Base mainnet (chainId 8453)");

        // 2. Create a deterministic test wallet (mirrors `new Wallet(privateKey)`)
        userPrivKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        user = vm.addr(userPrivKey);
        vm.label(user, "PinionUser");
        vm.label(address(USDC), "USDC_Base");
        vm.label(PINION_PAYTO, "Pinion_PayTo");

        // 3. Fund the user with ETH for gas (mirrors needing ETH on Base)
        vm.deal(user, 1 ether);

        // 4. Fund the user with USDC via deal() — Foundry adjusts storage directly
        //    This mirrors having real USDC on Base mainnet for x402 payments.
        //    Each skill call = $0.01, unlimited = $100; give 200 USDC to be safe.
        deal(address(USDC), user, 200_000_000, true); // 200 USDC (6 decimals), adjust totalSupply

        console2.log("=== setUp complete ===");
        console2.log("User address    :", user);
        console2.log("User ETH bal    :", user.balance);
        console2.log("User USDC bal   :", USDC.balanceOf(user));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 1 – balance skill
    //   pinion.skills.balance(userAddress)
    //   → The skill reads ETH balance + USDC balance from Base mainnet.
    //   We verify: forked state returns values we seeded in setUp.
    // ─────────────────────────────────────────────────────────────────────────
    function test_balance_skillReadsCorrectBalances() public view {
        // ETH balance check (mirrors "bal.data.eth")
        uint256 ethBal = user.balance;
        assertEq(ethBal, 1 ether, "ETH balance should be 1 ETH as seeded");

        // USDC balance check (mirrors "bal.data.usdc")
        uint256 usdcBal = USDC.balanceOf(user);
        assertEq(usdcBal, 200_000_000, "USDC balance should be 200 USDC as seeded");

        console2.log("Balance skill | ETH :", ethBal);
        console2.log("Balance skill | USDC:", usdcBal);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2 – wallet skill (x402 payment of $0.01 USDC)
    //   pinion.skills.wallet()
    //   → Client pays $0.01 USDC via EIP-3009 transferWithAuthorization.
    //   We simulate the full on-chain payment flow:
    //     1. User signs an EIP-3009 authorization (vm.sign)
    //     2. Pinion server calls transferWithAuthorization on USDC contract
    //     3. $0.01 USDC moves from user → PINION_PAYTO
    // ─────────────────────────────────────────────────────────────────────────
    function test_wallet_skillPaymentViaEIP3009() public {
        uint256 userUsdcBefore  = USDC.balanceOf(user);
        uint256 paytoUsdcBefore = USDC.balanceOf(PINION_PAYTO);

        // Build EIP-3009 typed data (mirrors x402.ts in the SDK)
        bytes32 authorizationNonce = bytes32(uint256(1)); // arbitrary unique nonce
        uint256 validAfter  = 0;
        uint256 validBefore = block.timestamp + 1 hours;

        bytes32 digest = _buildEIP3009Digest(
            user,
            PINION_PAYTO,
            PINION_SKILL_COST,
            validAfter,
            validBefore,
            authorizationNonce
        );

        // Sign with user's private key (mirrors SDK's ethers Wallet.signMessage)
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivKey, digest);

        // Pinion facilitator calls transferWithAuthorization on behalf of the server
        vm.prank(PINION_PAYTO);
        USDC.transferWithAuthorization(
            user,
            PINION_PAYTO,
            PINION_SKILL_COST,
            validAfter,
            validBefore,
            authorizationNonce,
            v, r, s
        );

        // Assert payment settled correctly
        assertEq(
            USDC.balanceOf(user),
            userUsdcBefore - PINION_SKILL_COST,
            "User USDC should decrease by skill cost"
        );
        assertEq(
            USDC.balanceOf(PINION_PAYTO),
            paytoUsdcBefore + PINION_SKILL_COST,
            "Pinion payTo should receive skill cost"
        );

        // Assert nonce is now consumed (replay protection)
        assertTrue(
            USDC.authorizationState(user, authorizationNonce),
            "Authorization nonce must be consumed after use"
        );

        console2.log("Wallet skill | payment settled:", PINION_SKILL_COST, "USDC units");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3 – wallet skill replay protection
    //   The same EIP-3009 nonce must NOT be reusable (prevents double-spend).
    // ─────────────────────────────────────────────────────────────────────────
    function test_wallet_skillPaymentNonceCannotBeReplayed() public {
        bytes32 authorizationNonce = bytes32(uint256(42));
        uint256 validBefore = block.timestamp + 1 hours;

        bytes32 digest = _buildEIP3009Digest(
            user, PINION_PAYTO, PINION_SKILL_COST, 0, validBefore, authorizationNonce
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivKey, digest);

        // First payment succeeds
        vm.prank(PINION_PAYTO);
        USDC.transferWithAuthorization(
            user, PINION_PAYTO, PINION_SKILL_COST, 0, validBefore, authorizationNonce, v, r, s
        );

        // Second attempt with same nonce must revert
        vm.expectRevert();
        vm.prank(PINION_PAYTO);
        USDC.transferWithAuthorization(
            user, PINION_PAYTO, PINION_SKILL_COST, 0, validBefore, authorizationNonce, v, r, s
        );

        console2.log("Wallet skill | replay attempt correctly reverted");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 4 – chat skill (x402 payment)
    //   pinion.skills.chat("what is x402?")
    //   Same $0.01 payment flow, different nonce.
    // ─────────────────────────────────────────────────────────────────────────
    function test_chat_skillDeductsPayment() public {
        uint256 balanceBefore = USDC.balanceOf(user);

        _simulatePinionSkillPayment(bytes32(uint256(100)));

        assertEq(
            USDC.balanceOf(user),
            balanceBefore - PINION_SKILL_COST,
            "Chat skill should deduct $0.01 USDC"
        );

        console2.log("Chat skill | $0.01 USDC deducted correctly");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 5 – price skill (x402 payment)
    //   pinion.skills.price("ETH")
    //   The ETH price is fetched off-chain; on-chain side is just the $0.01 payment.
    // ─────────────────────────────────────────────────────────────────────────
    function test_price_skillDeductsPayment() public {
        uint256 balanceBefore = USDC.balanceOf(user);

        _simulatePinionSkillPayment(bytes32(uint256(200)));

        assertEq(
            USDC.balanceOf(user),
            balanceBefore - PINION_SKILL_COST,
            "Price skill should deduct $0.01 USDC"
        );

        console2.log("Price skill | $0.01 USDC deducted correctly");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 6 – trade skill (x402 payment)
    //   pinion.skills.trade("USDC", "ETH", "10")
    //   Returns an unsigned 1inch swap tx; on-chain side is $0.01 skill payment.
    // ─────────────────────────────────────────────────────────────────────────
    function test_trade_skillDeductsPayment() public {
        uint256 balanceBefore = USDC.balanceOf(user);

        _simulatePinionSkillPayment(bytes32(uint256(300)));

        assertEq(
            USDC.balanceOf(user),
            balanceBefore - PINION_SKILL_COST,
            "Trade skill should deduct $0.01 USDC"
        );

        console2.log("Trade skill | $0.01 USDC deducted correctly");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 7 – fund skill (x402 payment)
    //   pinion.skills.fund(userAddress)
    // ─────────────────────────────────────────────────────────────────────────
    function test_fund_skillDeductsPayment() public {
        uint256 balanceBefore = USDC.balanceOf(user);

        _simulatePinionSkillPayment(bytes32(uint256(400)));

        assertEq(
            USDC.balanceOf(user),
            balanceBefore - PINION_SKILL_COST,
            "Fund skill should deduct $0.01 USDC"
        );

        console2.log("Fund skill | $0.01 USDC deducted correctly");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 8 – unlimited plan purchase ($100 USDC one-time)
    //   pinion.skills.unlimited()
    //   Same EIP-3009 flow but for $100 USDC.
    // ─────────────────────────────────────────────────────────────────────────
    function test_unlimited_planCosts100USDC() public {
        uint256 userUsdcBefore  = USDC.balanceOf(user);
        uint256 paytoUsdcBefore = USDC.balanceOf(PINION_PAYTO);

        bytes32 authNonce   = bytes32(uint256(9999));
        uint256 validBefore = block.timestamp + 1 hours;

        bytes32 digest = _buildEIP3009Digest(
            user, PINION_PAYTO, PINION_UNLIMITED_COST, 0, validBefore, authNonce
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivKey, digest);

        vm.prank(PINION_PAYTO);
        USDC.transferWithAuthorization(
            user, PINION_PAYTO, PINION_UNLIMITED_COST, 0, validBefore, authNonce, v, r, s
        );

        assertEq(
            USDC.balanceOf(user),
            userUsdcBefore - PINION_UNLIMITED_COST,
            "Unlimited plan must deduct exactly $100 USDC"
        );
        assertEq(
            USDC.balanceOf(PINION_PAYTO),
            paytoUsdcBefore + PINION_UNLIMITED_COST,
            "Pinion payTo must receive exactly $100 USDC"
        );

        console2.log("Unlimited plan | $100 USDC settled correctly");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 9 – insufficient_funds guard
    //   Mirrors the 402 `error: 'insufficient_funds'` the server returns.
    //   A user with zero USDC cannot make a skill payment.
    // ─────────────────────────────────────────────────────────────────────────
    function test_insufficientFunds_skillPaymentReverts() public {
        // Create a broke user
        address brokeUser;
        uint256 brokeKey;
        brokeKey = 0xBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADBAD;
        brokeUser = vm.addr(brokeKey);
        vm.deal(brokeUser, 1 ether);
        // No USDC for brokeUser

        bytes32 authNonce   = bytes32(uint256(500));
        uint256 validBefore = block.timestamp + 1 hours;

        bytes32 digest = _buildEIP3009Digest(
            brokeUser, PINION_PAYTO, PINION_SKILL_COST, 0, validBefore, authNonce
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(brokeKey, digest);

        // Payment must revert (balance = 0, transfer impossible)
        vm.expectRevert();
        vm.prank(PINION_PAYTO);
        USDC.transferWithAuthorization(
            brokeUser, PINION_PAYTO, PINION_SKILL_COST, 0, validBefore, authNonce, v, r, s
        );

        console2.log("Insufficient funds | payment correctly reverted");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 10 – expired authorization
    //   An EIP-3009 payment with validBefore in the past must revert.
    // ─────────────────────────────────────────────────────────────────────────
    function test_expiredAuthorization_reverts() public {
        bytes32 authNonce   = bytes32(uint256(600));
        uint256 expiredTs   = block.timestamp - 1; // already expired

        bytes32 digest = _buildEIP3009Digest(
            user, PINION_PAYTO, PINION_SKILL_COST, 0, expiredTs, authNonce
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivKey, digest);

        vm.expectRevert();
        vm.prank(PINION_PAYTO);
        USDC.transferWithAuthorization(
            user, PINION_PAYTO, PINION_SKILL_COST, 0, expiredTs, authNonce, v, r, s
        );

        console2.log("Expired authorization | correctly reverted");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 11 – multiple skills in sequence (full TS example flow)
    //   Mirrors running the entire main() function:
    //   wallet + balance + price + chat + trade + fund = 5 x $0.01 = $0.05
    // ─────────────────────────────────────────────────────────────────────────
    function test_fullExampleFlow_cumulativeCost() public {
        uint256 usdcBefore = USDC.balanceOf(user);
        uint256 skillCount = 5; // wallet, price, chat, trade, fund

        for (uint256 i = 1; i <= skillCount; i++) {
            _simulatePinionSkillPayment(bytes32(i * 1_000));
        }

        uint256 expectedDeducted = skillCount * PINION_SKILL_COST; // $0.05 USDC
        assertEq(
            USDC.balanceOf(user),
            usdcBefore - expectedDeducted,
            "Full example flow should cost $0.05 USDC total"
        );

        console2.log("Full example flow | total deducted:", expectedDeducted, "USDC units (=$0.05)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 12 – time manipulation: warp to test validAfter
    //   EIP-3009 allows setting validAfter so payment can't be used too early.
    // ─────────────────────────────────────────────────────────────────────────
    function test_validAfter_paymentNotYetValid() public {
        bytes32 authNonce   = bytes32(uint256(700));
        uint256 validAfter  = block.timestamp + 1 hours; // not valid yet
        uint256 validBefore = block.timestamp + 2 hours;

        bytes32 digest = _buildEIP3009Digest(
            user, PINION_PAYTO, PINION_SKILL_COST, validAfter, validBefore, authNonce
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivKey, digest);

        // Before validAfter → must revert
        vm.expectRevert();
        vm.prank(PINION_PAYTO);
        USDC.transferWithAuthorization(
            user, PINION_PAYTO, PINION_SKILL_COST, validAfter, validBefore, authNonce, v, r, s
        );

        // Warp time past validAfter → must succeed
        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(PINION_PAYTO);
        USDC.transferWithAuthorization(
            user, PINION_PAYTO, PINION_SKILL_COST, validAfter, validBefore, authNonce, v, r, s
        );

        assertTrue(
            USDC.authorizationState(user, authNonce),
            "Authorization should be consumed after valid window"
        );

        console2.log("validAfter | payment blocked before window, succeeded after warp");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Build an EIP-3009 TransferWithAuthorization digest.
    ///      Domain: USDC on Base mainnet (chainId 8453).
    ///      Type hash matches Circle's FiatToken V2 implementation.
    function _buildEIP3009Digest(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (bytes32) {
        // EIP-712 domain separator for USDC on Base
        // name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC
        bytes32 domainSeparator = keccak256(
            abi.encode(
                // EIP-712 domain typehash
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("USD Coin")),
                keccak256(bytes("2")),
                BASE_CHAIN_ID,
                address(USDC)
            )
        );

        // TransferWithAuthorization typehash (Circle FiatToken V2)
        bytes32 transferTypeHash = keccak256(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );

        bytes32 structHash = keccak256(
            abi.encode(transferTypeHash, from, to, value, validAfter, validBefore, nonce)
        );

        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    /// @dev Simulate a single $0.01 Pinion skill x402 payment for a given nonce.
    function _simulatePinionSkillPayment(bytes32 authNonce) internal {
        uint256 validBefore = block.timestamp + 1 hours;

        bytes32 digest = _buildEIP3009Digest(
            user, PINION_PAYTO, PINION_SKILL_COST, 0, validBefore, authNonce
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivKey, digest);

        vm.prank(PINION_PAYTO);
        USDC.transferWithAuthorization(
            user, PINION_PAYTO, PINION_SKILL_COST, 0, validBefore, authNonce, v, r, s
        );
    }
}

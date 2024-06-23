# MATCH_3

---
This is an SDK, a TypeScript client designed to facilitate interaction with the Match3 on-chain program.

## Installation

```bash
npm install @match3/sdk
```

## Usage

```typescript
import { Match3 } from "@winnerlabs/match3"

const provider = ...;
const match3 = new Match3(provider);
```

## Interfaces

### initMatch3Info

```typescript
    /**
     * Init Match3 game.
     * Only the administrator can call this function.
     *
     * @param admin The keypair of the admin.
    */
    async initMatch3Info (admin: Keypair) {}
```

### addNewTree

```typescript
    /**
     * Create and add a new Merkle tree to the Match3 game.
     * Only the administrator can call this function.
     *
     * @param {Keypair} admin - The keypair of the admin who is adding the new tree.
     * @param {Umi} umi - The Bubblegum Umi framework.
     * @param {number} [maxDepth=20] - The maximum depth of the Merkle tree. Defaults to 20.
     * @param {number} [maxBufferSize=64] - The maximum buffer size of the Merkle tree. Defaults to 64.
     * @param {number} [canopyDepth=14] - The canopy depth of the Merkle tree. Defaults to 14.
     *
    */
    async addNewTree (admin: Keypair, umi: Umi, maxDepth = 20, maxBufferSize = 64, canopyDepth = 14) {}
```

### mintScratchcard

```typescript
   /**
     * Mints a specified number of scratchcards for a player in the game.
     *
     * @param {Keypair} player - The keypair of the player who is minting the scratchcard.
     * @param {Umi} umi - The Bubblegum Umi framework used for interacting with the blockchain.
     * @param {number} [mint_quantity=1] - The number of scratchcards to mint. Defaults to 1.
     * @param {PublicKey} [scratchcard_owner=player.publicKey] - The PublicKey of the owner of the scratchcard. Defaults to the player's public key.
     * @param {PublicKey} [inviter_pubkey=PublicKey.default] - The PublicKey of the inviter of the player. Defaults to PublicKey.default.
     *
     * @returns {Promise<[bigint, number]>}
     *   - The scratchcard leaf index within the merkletree.
     *   - The player's current credits.
    */
    async mintScratchcard (player: Keypair, umi: Umi, mint_quantity = 1, scratchcard_owner = player.publicKey, inviter_pubkey = PublicKey.default): Promise<[bigint, number]>{}
```

### scratchingCard

```typescript
    /**
     * This function handles the process of scratching a card for a player in the game.
     * It interacts with the Umi protocol to perform operations related to the given asset ID.
     *
     * @param {Keypair} player - The keypair of the player who is scratching the card.
     * @param {Umi} umi - An instance of Bubblegum Umi framework
     * @param {UmiPk} asset_id - The asset ID associated with the card being scratched.
     *
     * @returns {Promise<[number, number, boolean, number]>}
     *   - The number of times the card has been scratched.
     *   - The latest scratched pattern
     *   - A boolean indicating whether the scratch resulted in a win or not.
     *   - player's current credits.
     */
    async scratchingCard (player: Keypair, umi: Umi, asset_id: UmiPk): Promise<[number, number, boolean, number]> {}
```

### transfer_scratchcard

```typescript
    /**
     * Transfers a scratchcard asset to a specified recipient.
     *
     * @param {Umi} umi - The Bubblegum Umi framework used for interacting with the blockchain.
     * @param {UmiPk} asset_id - The unique identifier of the scratchcard asset to be transferred.
     * @param {PublicKey} to - The PublicKey of the recipient to whom the scratchcard asset will be transferred.
     *
    */
    async transfer_scratchcard(umi: Umi, asset_id: UmiPk, to: PublicKey) {}
```
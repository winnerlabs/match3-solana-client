import * as anchor from "@coral-xyz/anchor";
import {MPL_BUBBLEGUM_PROGRAM_ID, findTreeConfigPda,
    fetchTreeConfigFromSeeds, LeafSchema , findLeafAssetIdPda,
    leafSchema, getAssetWithProof, transfer} from "@metaplex-foundation/mpl-bubblegum";
import { SPL_NOOP_PROGRAM_ID, SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, createAllocTreeIx } from "@solana/spl-account-compression";
import { Context, TransactionSignature, Umi, PublicKey as UmiPk } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey, fromWeb3JsPublicKey} from '@metaplex-foundation/umi-web3js-adapters';
import { Keypair, PublicKey } from "@solana/web3.js";
import {parseLeafFromMintV1Transaction, checkPdaAccountExistence, LoadProgramIdl} from "./utils";
import {
    SB_ON_DEMAND_PID,
    Randomness,
    InstructionUtils,
  } from "@switchboard-xyz/on-demand";
import bs58 from 'bs58';
import idl from "./IDL/idl.json";
import sbOnDemandIdl from "./IDL/sb_on_demand_dev.json";

const ADMIN_PUBLIC_KEY: PublicKey = new PublicKey("6T9ajVYoL13jeNp9FCMoU9s4AEBaNFJpHvXptUz1MGag");
const [match3InfoPDA, _bump]= PublicKey.findProgramAddressSync(
    [Buffer.from("match3"), ADMIN_PUBLIC_KEY.toBuffer()],
    new PublicKey(idl.metadata.address)
)
// Switchboard sbQueue fixed
const sbQueue = new PublicKey("FfD96yeXs4cxZshoPPSKhSPgVQxLAJUT3gefgh84m1Di");
export const MATCH3_INFO_PDA: Readonly<PublicKey> = match3InfoPDA;
export class Match3 {
    public program: anchor.Program;
    constructor(provider: anchor.Provider) {
        const programId = new PublicKey(idl.metadata.address);
        this.program = new anchor.Program(
            idl as anchor.Idl,
            programId,
            provider
        );
    }
    /**
     * Init Match3 game.
     * Only the administrator can call this function.
     *
     * @param admin The keypair of the admin.
    */
    async initMatch3Info (admin: Keypair) {
        // check admin and umi's public key TODO
        if (!(admin.publicKey.equals(ADMIN_PUBLIC_KEY))) {
            throw new Error("Only the administrator can call this function.");
        }
        const [inviterPlaceholderPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("player_config"), PublicKey.default.toBuffer()],
            this.program.programId
        );
        const tx = await this.program.methods
        .initMatch3()
        .accounts({
            match3Info: match3InfoPDA,
            placeHolder: inviterPlaceholderPDA,
        })
        .signers([admin])
        .rpc();
        console.log("init Match3 game tx: ", tx);
    }
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
    async addNewTree (admin: Keypair, umi: Umi, maxDepth = 20, maxBufferSize = 64, canopyDepth = 14) {
        if (!(admin.publicKey.equals(ADMIN_PUBLIC_KEY))) {
            throw new Error("Only the administrator can call this function.");
        }
        const merkleTree = anchor.web3.Keypair.generate();
        const merkleTreeUmiPk = fromWeb3JsPublicKey(merkleTree.publicKey);
        const treeConfigPda = await findTreeConfigPda(umi,
            {merkleTree: merkleTreeUmiPk}
        )[0];
        const treeConfigPubkey = toWeb3JsPublicKey(treeConfigPda);
        console.log(`Creating Merkle Tree...${merkleTree.publicKey.toString()}, treeConfig: ${treeConfigPubkey.toString()}`);
        // const merkleTreeSize = await getMerkleTreeSize(maxDepth, maxBufferSize, canopyDepth);
        // console.log(`Merkle Tree size: ${merkleTreeSize}`);
        /* the tree space needs to be allocated in a separate non-nested instruction
            as a nested CPI call cannot reallocate more than 10KB of space
        */
        const allocTreeIx = await createAllocTreeIx(
            this.program.provider.connection,
            merkleTree.publicKey,
            admin.publicKey,
            { maxDepth: 20, maxBufferSize: 64 },
            14,
        );
        const addNewTreeIx = await this.program.methods
        .addNewTree()
        .accounts({
            match3Info: match3InfoPDA,
            merkleTree: merkleTree.publicKey,
            treeConfig: treeConfigPubkey,
            logWrapper: SPL_NOOP_PROGRAM_ID,
            bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
            compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        })
        .instruction();
        const tx = new anchor.web3.Transaction().add(allocTreeIx).add(addNewTreeIx);
        console.log("sending transaction...");
        if (this.program.provider.sendAndConfirm) {
            const sig = await this.program.provider.sendAndConfirm(tx, [admin, merkleTree], {skipPreflight: true, commitment: 'confirmed'});
            console.log("add new tree tx: ", sig);
        } else {
            throw new Error("sendAndConfirm is undefined on provider");
        }
        let treeFound = false;
        while (!treeFound) {
            try {
                const treeConfig = await fetchTreeConfigFromSeeds(umi, {
                    merkleTree: merkleTreeUmiPk,
                });
                treeFound = true;
                console.log(`🌲 Merkle Tree created: ${merkleTree.publicKey.toString()}. Config:`)
                console.log(`     - Total Mint Capacity ${Number(treeConfig.totalMintCapacity).toLocaleString()}`);
                console.log(`     - Number Minted: ${Number(treeConfig.numMinted).toLocaleString()}`);
                console.log(`     - Is Public: ${treeConfig.isPublic}`);
                console.log(`     - Is Decompressible: ${treeConfig.isDecompressible}`);
            } catch (error) {
                await new Promise((resolve) => setTimeout(resolve, 5000));
            }
        }
    }

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
    async mintScratchcard (player: Keypair, umi: Umi, mint_quantity = 1, scratchcard_owner = player.publicKey, inviter_pubkey = PublicKey.default): Promise<[bigint, number]>{
        const match3Info = await this.program.account.match3Info.fetch(match3InfoPDA);
        const [treeConfig] = findTreeConfigPda(umi,{merkleTree: fromWeb3JsPublicKey(match3Info.merkleTree as PublicKey)});
        const [playerConfigPDA] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("player_config"), player.publicKey.toBuffer()],
            this.program.programId
        );
        const playerConfigIsExist = await checkPdaAccountExistence(playerConfigPDA, this.program.provider.connection);
        // if the playerConfig account exists and an invitation relationship is already bound, then use the already bound inviter's public key directly.
        let finalInviterPubkey = inviter_pubkey;
        if (playerConfigIsExist) {
            const playerConfig = await this.program.account.playerConfig.fetch(playerConfigPDA);
            if (!(playerConfig.inviter_pubkey as PublicKey).equals(PublicKey.default)) {
                finalInviterPubkey = playerConfig.inviter_pubkey as PublicKey;
            }
        }
        // end
        const [inviterConfigPDA] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("player_config"), inviter_pubkey.toBuffer()],
            this.program.programId
        );

        console.log("programId: ", this.program.programId.toString());
        console.log("inviterConfigPDA: ", inviterConfigPDA.toString());
        const tx = await this.program.methods
            .mintScratchcard(finalInviterPubkey, mint_quantity)
            .accounts({
                playerConfig: playerConfigPDA,
                match3Info: match3InfoPDA,
                inviterConfig: inviterConfigPDA,
                treeConfig: treeConfig,
                leafOwner: scratchcard_owner,
                merkleTree: match3Info.merkleTree as PublicKey,
                logWrapper: SPL_NOOP_PROGRAM_ID,
                compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
                bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            }).transaction();
        tx.recentBlockhash = (await this.program.provider.connection.getLatestBlockhash("finalized")).blockhash;
        tx.feePayer = player.publicKey;
        if (this.program.provider.sendAndConfirm) {
            const sig = await this.program.provider.sendAndConfirm(tx, [player], {skipPreflight: false, preflightCommitment: "finalized", commitment: 'finalized'});
            console.log("mint scratchcard sig: ", sig);
            // fetch cNFT leaf assetId
            const leaf: LeafSchema = await parseLeafFromMintV1Transaction(umi, bs58.decode(sig), playerConfigIsExist);
            console.log("leaf: ", leaf.nonce);
            const playerConfigInfo = await this.program.account.playerConfig.fetch(playerConfigPDA);
            return [leaf.nonce, playerConfigInfo.credits as number];
        } else {
            throw new Error("sendAndConfirm is undefined on provider");
        }
    }

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
    async scratchingCard (player: Keypair, umi: Umi, asset_id: UmiPk): Promise<[number, number, boolean, number]> {
        const match3Info = await this.program.account.match3Info.fetch(match3InfoPDA);
        console.log("merketree: ", (match3Info.merkleTree as PublicKey).toString());
        const asset = await umi.rpc.getAsset(asset_id);
        const assetIdWeb3Pk = toWeb3JsPublicKey(asset_id);
        // check if the asset is owned by the player
        const assetOwner = toWeb3JsPublicKey(asset.ownership.owner);
        if (!assetOwner.equals(player.publicKey)) {
            throw new Error("The asset is not owned by the player");
        }
        // end
        console.log("asset: ", asset.compression.leaf_id);
        const [playerConfigPDA] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("player_config"), player.publicKey.toBuffer()],
            this.program.programId
        );
        const [scratchcardPDA] = anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from("scratchcard"), assetIdWeb3Pk.toBuffer()],
                this.program.programId
        );
        console.log("scratchcardPDA: ", scratchcardPDA.toString());
        console.log("sb programid: ", SB_ON_DEMAND_PID.toString());
        // const sbProgramIDL = await anchor.Program.fetchIdl(SB_ON_DEMAND_PID, this.program.provider);
        // if (!sbProgramIDL) {
        //     throw new Error("sbProgramIDL is undefined");
        // }
        const sbProgram = new anchor.Program(sbOnDemandIdl as anchor.Idl, SB_ON_DEMAND_PID);
        const rngKp = Keypair.generate();
        const [randomness, ix] = await Randomness.create(sbProgram, rngKp, sbQueue);
        const commitIx = await randomness.commitIx(sbQueue);
        console.log("randomness address: ", randomness.pubkey.toString());
        const tx = await InstructionUtils.asV0Tx(sbProgram, [ix, commitIx]);
        if (this.program.provider.sendAndConfirm) {
            const sig = await this.program.provider.sendAndConfirm(tx, [player, rngKp]);
            console.log("Your create randomness transaction signature: ", sig);
        } else {
            throw new Error("sendAndConfirm is undefined on provider");
        }
        const scratchIx = await this.program.methods
            .scratchingCard(2)
            .accounts({
            scratchcard: scratchcardPDA,
            leafOwner: player.publicKey,
            leafAssetId: assetIdWeb3Pk,
            randomnessAccountData: randomness.pubkey,
            playerConfig: playerConfigPDA,
            match3Info: match3InfoPDA,
            })
            .instruction();
        await randomness.commitAndReveal([scratchIx], [player], sbQueue);

        const scratchcardInfo = await this.program.account.scratchCard.fetch(scratchcardPDA);
        const playerConfigInfo = await this.program.account.playerConfig.fetch(playerConfigPDA);
        return [scratchcardInfo.numberOfScratched as number,
            scratchcardInfo.latestScratchedPattern as number,
            scratchcardInfo.is_win as boolean,
            playerConfigInfo.credits as number];
    }
    /**
     * Transfers a scratchcard asset to a specified recipient.
     *
     * @param {Umi} umi - The Bubblegum Umi framework used for interacting with the blockchain.
     * @param {UmiPk} asset_id - The unique identifier of the scratchcard asset to be transferred.
     * @param {PublicKey} to - The PublicKey of the recipient to whom the scratchcard asset will be transferred.
     *
    */
    async transfer_scratchcard(umi: Umi, asset_id: UmiPk, to: PublicKey) {
        console.log("transfer_scratchcard, asset_id: ", asset_id.toString());
        const assetWithProof = await getAssetWithProof(umi, asset_id);
        const {signature, result} = await transfer(umi, {
            ...assetWithProof,
            leafOwner: umi.payer.publicKey,
            newLeafOwner: fromWeb3JsPublicKey(to),
          }).sendAndConfirm(umi)
        console.log("transfer_scratchcard, signature: ", signature);
    }
}


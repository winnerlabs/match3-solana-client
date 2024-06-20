import * as anchor from "@coral-xyz/anchor";
import {MPL_BUBBLEGUM_PROGRAM_ID, findTreeConfigPda,
    fetchTreeConfigFromSeeds, LeafSchema , findLeafAssetIdPda} from "@metaplex-foundation/mpl-bubblegum";
import { SPL_NOOP_PROGRAM_ID, SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, createAllocTreeIx } from "@solana/spl-account-compression";
// import { generateSigner, Umi } from '@metaplex-foundation/umi';
import { Context, TransactionSignature, Umi, PublicKey as UmiPk } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey, toWeb3JsKeypair, fromWeb3JsPublicKey} from '@metaplex-foundation/umi-web3js-adapters';
import { Keypair, PublicKey, ComputeBudgetProgram} from "@solana/web3.js";
import bs58 from 'bs58';
import idl from "./IDL/idl.json";
import {parseLeafFromMintV1Transaction, checkPdaAccountExistence} from "./utils";

const ADMIN_PUBLIC_KEY: PublicKey = new PublicKey("6T9ajVYoL13jeNp9FCMoU9s4AEBaNFJpHvXptUz1MGag");
const [match3InfoPDA, _bump]= PublicKey.findProgramAddressSync(
    [Buffer.from("match3"), ADMIN_PUBLIC_KEY.toBuffer()],
    new PublicKey(idl.metadata.address)
)
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
    // Only the administrator can call this function.
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
    /*
    *   @param player: Keypair of the player who is minting the scratchcard
    *   @param umi: Bubblegum Umi framework
    *   @param mint_quantity: Number of scratchcards to mint, defaults to 1
    *   @param scratchcard_owner: PublicKey of the owner of the scratchcard, defaults to player's public key
    *   @param inviter_pubkey: PublicKey of the inviter of the player, defaults to PublicKey.default
    */
    async mintScratchcard (player: Keypair, umi: Umi, mint_quantity = 1, scratchcard_owner = player.publicKey, inviter_pubkey = PublicKey.default): Promise<bigint>{
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
            return leaf.nonce;
        } else {
            throw new Error("sendAndConfirm is undefined on provider");
        }
    }

    async scratchingCard (umi: Umi, asset_id: UmiPk) {
        const match3Info = await this.program.account.match3Info.fetch(match3InfoPDA);
        console.log("merketree: ", (match3Info.merkleTree as PublicKey).toString());
        const asset = await umi.rpc.getAsset(asset_id);
        console.log("asset: ", asset.compression.leaf_id);
        // const [scratchcardPDA] = anchor.web3.PublicKey.findProgramAddressSync(
        //         [Buffer.from("scratchcard"), assetId toBuffer("le", 8)],
        //         this.program.programId
        //     );
    }
}


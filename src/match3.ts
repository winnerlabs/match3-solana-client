import * as anchor from "@coral-xyz/anchor";
import {MPL_BUBBLEGUM_PROGRAM_ID, findTreeConfigPda, fetchTreeConfigFromSeeds} from "@metaplex-foundation/mpl-bubblegum";
import { SPL_NOOP_PROGRAM_ID, SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, createAllocTreeIx } from "@solana/spl-account-compression";
import { generateSigner, Umi } from '@metaplex-foundation/umi';
import { toWeb3JsPublicKey, toWeb3JsKeypair, fromWeb3JsPublicKey} from '@metaplex-foundation/umi-web3js-adapters';
import { Keypair, PublicKey } from "@solana/web3.js";
import idl from "./IDL/idl.json";

const ADMIN_PUBLIC_KEY: PublicKey = new PublicKey("6T9ajVYoL13jeNp9FCMoU9s4AEBaNFJpHvXptUz1MGag");
export class Match3 {
    public program: anchor.Program;
    public match3InfoPDA: PublicKey;
    constructor(provider: anchor.Provider) {
        const programId = new PublicKey(idl.metadata.address);
        this.program = new anchor.Program(
            idl as anchor.Idl,
            programId,
            provider
        );
        this.match3InfoPDA = PublicKey.default;
    }
    // Only the administrator can call this function.
    async initMatch3Info (admin: Keypair) {
        // check admin and umi's public key TODO
        if (!(admin.publicKey.equals(ADMIN_PUBLIC_KEY))) {
            throw new Error("Only the administrator can call this function.");
        }
        const [match3InfoPDA] = await PublicKey.findProgramAddressSync(
            [Buffer.from("match3"),  admin.publicKey.toBuffer()],
            this.program.programId
        )
        this.match3InfoPDA = match3InfoPDA;
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
            match3Info: this.match3InfoPDA,
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
}
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, impersonateAccount } = require("@nomicfoundation/hardhat-network-helpers");

describe("Flash Loan", function () {
    const USDC_ADDR = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const UNI_ADDR = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'
    const BINANCE_WALLET_ADDR = '0xF977814e90dA44bFA03b6295A0616a897441aceC'
    const AAVE_LENDING_POOL_ADDRESS_PROVIDER = '0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5';
    const UNISWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
    const USDC_PRICE = BigInt(1 * 1e18) * BigInt(1e12); // usdc's decimal is 6
    const UNI_PRICE = BigInt(10 * 1e18);
    const DROP_UNI_PRICE = BigInt(6.2 * 1e18);
    const UNI_COLLATERAL_FACTOR = BigInt(0.5 * 1e18);
    const CLOSE_FACTOR = BigInt(0.5 * 1e18);
    const LIQUIDATION_INCENTIVE = BigInt(1.08 * 1e18);
    const USDC_AMOUNT = BigInt(5000 * 1e6);
    const UNI_AMOUNT = BigInt(1000 * 1e18);

    const setup = async () => {
        // fork
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: "https://eth-mainnet.g.alchemy.com/v2/<KEY>",
                        blockNumber: 15815693,
                    },
                },
            ],
        });

        // get signers
        const [owner, signer1] = await ethers.getSigners();

        // get usdc contract
        const usdc = await ethers.getContractAt("TestERC20", USDC_ADDR);
        expect(await usdc.balanceOf(BINANCE_WALLET_ADDR)).to.gt(0)

        // get uni contract
        const uni = await ethers.getContractAt("TestERC20", UNI_ADDR);
        expect(await uni.balanceOf(BINANCE_WALLET_ADDR)).to.gt(0)

        // deploy comptroller
        const comptrollerFactory = await ethers.getContractFactory("Comptroller");
        const comptroller = await comptrollerFactory.deploy();
        await comptroller.deployed();

        // deploy price oracle
        const priceOracleFactory = await ethers.getContractFactory("SimplePriceOracle");
        const simplePriceOracle = await priceOracleFactory.deploy();
        await simplePriceOracle.deployed();

        // deploy interest rate model
        const interestRateModelFactory = await ethers.getContractFactory("WhitePaperInterestRateModel");
        const interestRateModel = await interestRateModelFactory.deploy(
            ethers.utils.parseUnits("0", 18),
            ethers.utils.parseUnits("0", 18),
        );
        await interestRateModel.deployed();


        const cErc20Factory = await ethers.getContractFactory("CErc20Immutable");
        // deploy cUsdc
        const cUsdc = await cErc20Factory.deploy(
            usdc.address,
            comptroller.address,
            interestRateModel.address,
            ethers.utils.parseUnits("1", 6),
            "c Token USDC",
            "cUSDC",
            18,
            owner.address,
        );
        await cUsdc.deployed();

        // deploy cUni
        const cUni = await cErc20Factory.deploy(
            uni.address,
            comptroller.address,
            interestRateModel.address,
            ethers.utils.parseUnits("1", 18),
            "c Token UNI",
            "cUNI",
            18,
            owner.address,
        );
        await cUni.deployed();

        // set price
        // note: usdc's decimal is 6, so need to multiply 10 ** 12
        await simplePriceOracle.setUnderlyingPrice(cUsdc.address, USDC_PRICE);
        await simplePriceOracle.setUnderlyingPrice(cUni.address, UNI_PRICE);

        // set price oracle to comptroller
        await comptroller._setPriceOracle(simplePriceOracle.address);

        // set support market
        await comptroller._supportMarket(cUsdc.address);
        await comptroller._supportMarket(cUni.address);

        // set cUni as collateral
        await comptroller.enterMarkets([cUni.address]);

        //set UNI's collateral factor
        await comptroller._setCollateralFactor(cUni.address, UNI_COLLATERAL_FACTOR);

        // set close factor
        await comptroller._setCloseFactor(CLOSE_FACTOR);

        // set liquidation incentive
        await comptroller._setLiquidationIncentive(LIQUIDATION_INCENTIVE);

        return {
            owner, signer1,
            usdc, cUsdc,
            uni, cUni,
            comptroller,
            simplePriceOracle,
        }
    }

    const transferFromBinanceWallet = async () => {
        const {
            owner, signer1,
            usdc, cUsdc,
            uni, cUni,
            comptroller,
            simplePriceOracle,
        } = await loadFixture(setup)

        await impersonateAccount(BINANCE_WALLET_ADDR);
        const binance = await ethers.getSigner(BINANCE_WALLET_ADDR);

        await uni.connect(binance).transfer(owner.address, UNI_AMOUNT);
        await usdc.connect(binance).transfer(signer1.address, USDC_AMOUNT);

        return {
            owner, signer1,
            usdc, cUsdc,
            uni, cUni,
            comptroller,
            simplePriceOracle,
        }
    }

    const borrowUSDC = async () => {
        const {
            owner, signer1,
            usdc, cUsdc,
            uni, cUni,
            comptroller,
            simplePriceOracle,
        } = await loadFixture(transferFromBinanceWallet)

        // signer1 supply 5000 USDC
        await usdc.connect(signer1).approve(cUsdc.address, USDC_AMOUNT);
        await cUsdc.connect(signer1).mint(USDC_AMOUNT);

        // owner supply 1000 UNI
        await uni.approve(cUni.address, UNI_AMOUNT);
        await cUni.mint(UNI_AMOUNT);

        // owner borrow 5000 USDC
        await cUsdc.borrow(USDC_AMOUNT);

        return {
            owner, signer1,
            usdc, cUsdc,
            uni, cUni,
            comptroller,
            simplePriceOracle,
        }
    }

    it("transfer uni token from BinanceWallet to owner", async function () {
        const { owner, uni } = await loadFixture(setup)

        await impersonateAccount(BINANCE_WALLET_ADDR);
        const binance = await ethers.getSigner(BINANCE_WALLET_ADDR);

        await uni.connect(binance).transfer(owner.address, UNI_AMOUNT);
        expect(await uni.balanceOf(owner.address)).to.eq(UNI_AMOUNT);
    });

    it("transfer usdc token from BinanceWallet to signer1", async function () {
        const { signer1, usdc } = await loadFixture(setup)

        await impersonateAccount(BINANCE_WALLET_ADDR);
        const binance = await ethers.getSigner(BINANCE_WALLET_ADDR);

        await usdc.connect(binance).transfer(signer1.address, USDC_AMOUNT);
        expect(await usdc.balanceOf(signer1.address)).to.eq(USDC_AMOUNT);
    });

    it("use UNI as colleteral to borrow USDC", async function () {
        const {
            owner, signer1,
            usdc, cUsdc,
            uni, cUni,
        } = await loadFixture(transferFromBinanceWallet)


        // supply 5000 USDC
        await usdc.connect(signer1).approve(cUsdc.address, USDC_AMOUNT);
        await cUsdc.connect(signer1).mint(USDC_AMOUNT);

        // supply 1000 UNI
        await uni.approve(cUni.address, UNI_AMOUNT);
        await cUni.mint(UNI_AMOUNT);

        // assert borrow 5000 USDC success
        await expect(cUsdc.borrow(USDC_AMOUNT)).to
            .changeTokenBalances(
                usdc,
                [owner, cUsdc],
                [USDC_AMOUNT, -USDC_AMOUNT],
            );
    })

    it("flashloan", async () => {
        const {
            owner, signer1,
            usdc, cUsdc,
            uni, cUni,
            comptroller,
            simplePriceOracle,
        } = await loadFixture(borrowUSDC)

        await simplePriceOracle.setUnderlyingPrice(cUni.address, DROP_UNI_PRICE);

        const result = await comptroller.getAccountLiquidity(owner.address);
        expect(result[2]).to.gt(0);

        const borrowBalance = await cUsdc.callStatic.borrowBalanceCurrent(owner.address);

        const repayAmount = BigInt(borrowBalance) * CLOSE_FACTOR / BigInt(1e18);

        const flashLoanFactory = await ethers.getContractFactory("MyFlashLoan");
        const flashLoan = await flashLoanFactory.deploy(
            AAVE_LENDING_POOL_ADDRESS_PROVIDER,
            UNISWAP_ROUTER
        );
        await flashLoan.deployed()

        await flashLoan.connect(signer1)
            .flashLoan(
                [usdc.address],
                [repayAmount],
                [0],
                owner.address,
                cUsdc.address,
                cUni.address,
                uni.address
            );

        const reward = await usdc.balanceOf(flashLoan.address)

        expect(reward).to.gt(0);

        console.log(`flashLoan liqudate reward: ${reward}`)
    });

});
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IBAP578Staking - Interface for BAP-578 Agent Staking
 * @dev Interface for staking BNB with agents to earn rewards
 */
interface IBAP578Staking {
    // ============ ENUMS ============

    /**
     * @dev Lock period options for staking
     */
    enum LockPeriod {
        FLEXIBLE,   // 0 - No lock, 1.0x multiplier
        DAYS_30,    // 1 - 30 days, 1.25x multiplier
        DAYS_90,    // 2 - 90 days, 1.75x multiplier
        DAYS_180    // 3 - 180 days, 2.5x multiplier
    }

    /**
     * @dev Status of a stake
     */
    enum StakeStatus {
        NONE,       // No stake exists
        ACTIVE,     // Currently staking (flexible)
        LOCKED,     // In lock period
        UNLOCKED,   // Lock expired, can withdraw
        UNSTAKED    // Fully withdrawn
    }

    // ============ STRUCTS ============

    /**
     * @dev Stake information structure
     */
    struct Stake {
        uint256 stakeId;              // Unique stake ID
        uint256 agentId;              // Associated agent token ID
        address staker;               // Owner of the stake
        uint256 amount;               // Amount of BNB staked
        uint256 shares;               // Share of reward pool
        LockPeriod lockPeriod;        // Selected lock period
        uint256 startTime;            // When stake was created
        uint256 lockEndTime;          // When lock expires (0 if flexible)
        uint256 lastClaimTime;        // Last reward claim timestamp
        uint256 totalRewardsClaimed;  // Lifetime rewards claimed
        StakeStatus status;           // Current stake status
    }

    /**
     * @dev Agent staking aggregated info
     */
    struct AgentStakeInfo {
        uint256 totalStaked;          // Total BNB staked with this agent
        uint256 stakerCount;          // Number of unique stakers
        uint256 bonusMultiplier;      // Learning bonus (basis points, 10000 = 1x)
        bool learningEnabled;         // If agent has learning
    }

    /**
     * @dev User staking summary
     */
    struct UserStakingInfo {
        uint256[] stakeIds;           // All user's stake IDs
        uint256 totalStaked;          // Total staked by user
        uint256 totalShares;          // Total shares owned
        uint256 lifetimeRewards;      // All-time rewards earned
    }

    /**
     * @dev Pool statistics
     */
    struct PoolStats {
        uint256 totalStaked;          // Total BNB in pool
        uint256 totalShares;          // Total shares issued
        uint256 totalStakers;         // Number of unique stakers
        uint256 rewardRate;           // Rewards per second
        uint256 lastUpdateTime;       // Last reward update
        uint256 rewardPerShareStored; // Accumulated rewards per share
        uint256 pendingRewards;       // Rewards waiting to be distributed
    }

    // ============ EVENTS ============

    event Staked(
        uint256 indexed stakeId,
        address indexed staker,
        uint256 indexed agentId,
        uint256 amount,
        LockPeriod lockPeriod,
        uint256 shares
    );

    event AddedToStake(
        uint256 indexed stakeId,
        address indexed staker,
        uint256 addedAmount,
        uint256 newTotal,
        uint256 additionalShares
    );

    event Unstaked(
        uint256 indexed stakeId,
        address indexed staker,
        uint256 amount,
        uint256 rewards
    );

    event EmergencyUnstaked(
        uint256 indexed stakeId,
        address indexed staker,
        uint256 returned,
        uint256 penalty
    );

    event RewardsClaimed(
        uint256 indexed stakeId,
        address indexed staker,
        uint256 amount
    );

    event RewardsCompounded(
        uint256 indexed stakeId,
        address indexed staker,
        uint256 amount,
        uint256 newShares
    );

    event Restaked(
        uint256 indexed stakeId,
        address indexed staker,
        LockPeriod newLockPeriod,
        uint256 newLockEndTime
    );

    event RewardsReceived(
        uint256 amount,
        uint256 newRewardRate,
        uint256 timestamp
    );

    event StakeTransferred(
        uint256 indexed stakeId,
        address indexed oldOwner,
        address indexed newOwner,
        uint256 agentId
    );

    event AgentBonusUpdated(
        uint256 indexed agentId,
        uint256 oldBonus,
        uint256 newBonus
    );

    // ============ STAKING FUNCTIONS ============

    /**
     * @dev Stakes BNB with a specific agent (only agent owner)
     * @param agentId The agent token ID to stake with
     * @param lockPeriod The lock period selection
     * @return stakeId The ID of the created stake
     */
    function stake(
        uint256 agentId,
        LockPeriod lockPeriod
    ) external payable returns (uint256 stakeId);

    /**
     * @dev Adds more BNB to an existing stake
     * @param stakeId The existing stake ID
     */
    function addToStake(uint256 stakeId) external payable;

    /**
     * @dev Unstakes BNB (only if unlocked or flexible)
     * @param stakeId The stake ID to unstake
     */
    function unstake(uint256 stakeId) external;

    /**
     * @dev Emergency unstake with 25% penalty (during lock)
     * @param stakeId The stake ID to emergency unstake
     */
    function emergencyUnstake(uint256 stakeId) external;

    /**
     * @dev Restakes after lock expires with new lock period
     * @param stakeId The stake ID to restake
     * @param newLockPeriod New lock period selection
     */
    function restake(uint256 stakeId, LockPeriod newLockPeriod) external;

    // ============ REWARD FUNCTIONS ============

    /**
     * @dev Claims pending rewards for a stake
     * @param stakeId The stake ID to claim for
     * @return amount The amount of rewards claimed
     */
    function claimRewards(uint256 stakeId) external returns (uint256 amount);

    /**
     * @dev Claims rewards for all user's stakes
     * @return totalAmount The total amount of rewards claimed
     */
    function claimAllRewards() external returns (uint256 totalAmount);

    /**
     * @dev Auto-compounds rewards back into stake
     * @param stakeId The stake ID to compound
     * @return compoundedAmount The amount that was compounded
     */
    function compoundRewards(uint256 stakeId) external returns (uint256 compoundedAmount);

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Gets pending rewards for a stake
     * @param stakeId The stake ID
     * @return The pending reward amount
     */
    function pendingRewards(uint256 stakeId) external view returns (uint256);

    /**
     * @dev Gets stake information
     * @param stakeId The stake ID
     * @return The stake struct
     */
    function getStake(uint256 stakeId) external view returns (Stake memory);

    /**
     * @dev Gets all stakes for a user
     * @param user The user address
     * @return Array of stakes
     */
    function getUserStakes(address user) external view returns (Stake[] memory);

    /**
     * @dev Gets user staking summary
     * @param user The user address
     * @return The user staking info
     */
    function getUserStakingInfo(address user) external view returns (UserStakingInfo memory);

    /**
     * @dev Gets agent staking info
     * @param agentId The agent ID
     * @return The agent stake info
     */
    function getAgentStakeInfo(uint256 agentId) external view returns (AgentStakeInfo memory);

    /**
     * @dev Gets pool statistics
     * @return The pool stats
     */
    function getPoolStats() external view returns (PoolStats memory);

    /**
     * @dev Gets current APY for a lock period (basis points)
     * @param lockPeriod The lock period
     * @return The estimated APY in basis points
     */
    function getAPY(LockPeriod lockPeriod) external view returns (uint256);

    /**
     * @dev Calculates shares for a given amount and lock period
     * @param amount The stake amount
     * @param lockPeriod The lock period
     * @param agentId The agent ID (for learning bonus)
     * @return shares The calculated shares
     */
    function calculateShares(
        uint256 amount,
        LockPeriod lockPeriod,
        uint256 agentId
    ) external view returns (uint256 shares);

    /**
     * @dev Gets the lock multiplier for a period (basis points)
     * @param lockPeriod The lock period
     * @return The multiplier in basis points
     */
    function getLockMultiplier(LockPeriod lockPeriod) external pure returns (uint256);

    // ============ INTEGRATION FUNCTIONS ============

    /**
     * @dev Called when an agent is transferred to update stake ownership
     * @notice This should be called by BAP578 contract on transfer
     * @param agentId The agent being transferred
     * @param newOwner The new owner of the agent
     */
    function onAgentTransfer(uint256 agentId, address newOwner) external;
}

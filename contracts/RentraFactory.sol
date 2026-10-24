// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./RentraOffering.sol";

/// @title RentraFactory - deploys and tracks an unlimited number of RentraOffering listings
/// @notice Demo only. One factory address is all the frontend needs; listings are discovered on-chain.
contract RentraFactory {
    /// @dev Every offering ever created through this factory, in creation order.
    address[] public offerings;

    event ListingDeployed(address indexed offering, address indexed owner, uint256 index);

    /// @notice Deploys a fresh RentraOffering owned by the caller. The caller then calls
    ///         createOffering(...) on the returned contract to publish the listing terms.
    /// @return offering The address of the newly deployed RentraOffering.
    function createListing() external returns (address offering) {
        RentraOffering deployed = new RentraOffering(msg.sender);
        offering = address(deployed);
        offerings.push(offering);
        emit ListingDeployed(offering, msg.sender, offerings.length - 1);
    }

    /// @notice Total number of listings deployed through this factory.
    function offeringCount() external view returns (uint256) {
        return offerings.length;
    }

    /// @notice Returns every offering address. Suitable for a demo marketplace; the frontend
    ///         paginates client-side. For large sets, prefer getOfferingsPaged.
    function getAllOfferings() external view returns (address[] memory) {
        return offerings;
    }

    /// @notice Returns a page of offering addresses.
    /// @param start Zero-based index of the first offering to return.
    /// @param count Maximum number of offerings to return.
    function getOfferingsPaged(uint256 start, uint256 count)
        external
        view
        returns (address[] memory page)
    {
        uint256 total = offerings.length;
        if (start >= total) {
            return new address[](0);
        }
        uint256 end = start + count;
        if (end > total) {
            end = total;
        }
        page = new address[](end - start);
        for (uint256 i = start; i < end; i += 1) {
            page[i - start] = offerings[i];
        }
    }
}
